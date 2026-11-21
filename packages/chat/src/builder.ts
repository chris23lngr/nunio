import type { Answerer } from "@nunio/ai";
import type { PrismaClient } from "@nunio/db";
import type {
  AgentCapability,
  AgentTrigger,
  ApprovalMode,
  CapabilityId,
  Delegation,
  Metered,
  Principal,
} from "@nunio/delegation";
import {
  approvalModes,
  capabilities,
  capabilityIds,
  checkTrigger,
  withOwner,
} from "@nunio/delegation";
import { definitely } from "@nunio/knowledge";
import type { ModelMessage, Tool, UIMessageChunk } from "ai";
import { jsonSchema, tool } from "ai";
import { retryRateLimited } from "./retry.js";
import { fenced } from "./turn.js";

/**
 * An Agent's form as it stands in the browser, unsaved: everything the builder may read of it. It never holds the
 * Budget or the Model (ADR-0026 amendment "The builder").
 */
export type BuilderForm = {
  name: string;
  description: string;
  instructions: string;
  courseIds: string[];
  capabilities: { id: CapabilityId; mode: ApprovalMode | null }[];
  /** Its Uhrzeit is null while the field holds no time. */
  trigger: {
    rhythm: "daily" | "weekdays";
    weekdays: number[];
    minute: number | null;
  };
};

/** One message of the conversation, which only the browser keeps. */
export type BuilderMessage = { role: "student" | "builder"; text: string };

/** The fields the builder fills, each already within the form's rules; the browser writes them into the form. */
export type FormFill = {
  name?: string;
  description?: string;
  instructions?: string;
  trigger?: AgentTrigger;
  courseIds?: string[];
  capabilities?: AgentCapability[];
};

type ListedCourse = { id: string; archived: boolean };

const timeOf = (minute: number) =>
  `${String(Math.floor(minute / 60)).padStart(2, "0")}:${String(minute % 60).padStart(2, "0")}`;

/** The one tool: it fills the form. No Budget, Model or emoji field exists, and Capabilities are those in code. */
function fillFormTool(handles: string[]): Tool {
  const listed = capabilityIds.map((id) => {
    const { title, description, modes } = capabilities[id];
    return `- ${id}: ${title}. ${description} ${
      modes.length
        ? `Modes: ${modes.join(", ")} (default ${modes[0]}).`
        : "No mode: on or off."
    }`;
  });
  return tool({
    description: [
      "Fills the Agent's form. Give only the fields to change; capabilities replaces the whole list. The student reviews every change and saves it themselves.",
      "Modes: always acts without asking, automatic acts but asks for changes within 24 hours or against the student's Preferences, ask asks before every Action.",
      "Capabilities:",
      ...listed,
    ].join("\n"),
    inputSchema: jsonSchema({
      type: "object",
      properties: {
        name: { type: "string", maxLength: 80 },
        description: { type: "string", maxLength: 500 },
        instructions: {
          type: "string",
          maxLength: 4000,
          description: "What the Agent should do, in the student's words.",
        },
        trigger: {
          type: "object",
          description:
            "When it runs, in the student's time zone: daily, or on weekdays (ISO, 1 is Monday), at a time HH:MM.",
          properties: {
            rhythm: { type: "string", enum: ["daily", "weekdays"] },
            weekdays: {
              type: "array",
              items: { type: "integer", minimum: 1, maximum: 7 },
            },
            time: { type: "string", pattern: "^\\d{2}:\\d{2}$" },
          },
          required: ["rhythm", "time"],
          additionalProperties: false,
        },
        ...(handles.length
          ? {
              courses: {
                type: "array",
                description: "Its Courses, by handle; at least one.",
                items: { type: "string", enum: handles },
              },
            }
          : {}),
        capabilities: {
          type: "array",
          items: {
            type: "object",
            properties: {
              id: { type: "string", enum: [...capabilityIds] },
              mode: { type: "string", enum: [...approvalModes] },
            },
            required: ["id"],
            additionalProperties: false,
          },
        },
      },
      additionalProperties: false,
    }),
  });
}

const text = (value: unknown, max: number) =>
  typeof value === "string" && value.trim()
    ? value.trim().slice(0, max)
    : undefined;

/**
 * What the model's call may change, held to the form's rules whatever it sent: Courses it may give, Capabilities in
 * code on a mode they allow (Lernblöcke verschieben only on Nachfragen), and the v1 rhythms. Anything else is dropped.
 */
function fillOf(
  input: unknown,
  form: BuilderForm,
  courses: Map<string, ListedCourse>,
): FormFill | null {
  if (!input || typeof input !== "object") return null;
  const given = input as Record<string, unknown>;
  const fill: FormFill = {};
  const name = text(given.name, 80);
  if (name) fill.name = name;
  const description = text(given.description, 500);
  if (description) fill.description = description;
  const instructions = text(given.instructions, 4000);
  if (instructions) fill.instructions = instructions;

  const trigger = given.trigger as Record<string, unknown> | undefined;
  if (trigger && typeof trigger === "object") {
    const time =
      typeof trigger.time === "string"
        ? /^(\d{2}):(\d{2})$/.exec(trigger.time)
        : null;
    const minute =
      time && Number(time[1]) < 24 && Number(time[2]) < 60
        ? Number(time[1]) * 60 + Number(time[2])
        : form.trigger.minute;
    const checked =
      minute === null
        ? null
        : trigger.rhythm === "daily"
          ? checkTrigger({ rhythm: "daily", minute })
          : trigger.rhythm === "weekdays"
            ? checkTrigger({
                rhythm: "weekdays",
                weekdays: trigger.weekdays as number[],
                minute,
              })
            : null;
    if (checked) fill.trigger = checked;
  }

  if (Array.isArray(given.courses)) {
    // A Course the student archived may stay on the form but is not added.
    const ids = given.courses.flatMap((handle) => {
      const course =
        typeof handle === "string" ? courses.get(handle) : undefined;
      return course && (!course.archived || form.courseIds.includes(course.id))
        ? [course.id]
        : [];
    });
    if (ids.length) fill.courseIds = [...new Set(ids)];
  }

  if (Array.isArray(given.capabilities)) {
    const held = new Map(form.capabilities.map((c) => [c.id, c.mode]));
    const chosen = new Map<CapabilityId, ApprovalMode | null>();
    for (const each of given.capabilities as {
      id?: unknown;
      mode?: unknown;
    }[]) {
      const id = each?.id;
      if (
        typeof id !== "string" ||
        !Object.hasOwn(capabilities, id) ||
        chosen.has(id as CapabilityId)
      )
        continue;
      const allowed: readonly string[] = capabilities[id as CapabilityId].modes;
      const keep = (mode: unknown) =>
        typeof mode === "string" && allowed.includes(mode)
          ? (mode as ApprovalMode)
          : undefined;
      chosen.set(
        id as CapabilityId,
        allowed.length
          ? (keep(each.mode) ??
              keep(held.get(id as CapabilityId)) ??
              (allowed[0] as ApprovalMode))
          : null,
      );
    }
    // An empty list takes every Capability off; a list with none known changes nothing.
    if (chosen.size || !given.capabilities.length)
      fill.capabilities = capabilityIds
        .filter((id) => chosen.has(id))
        .map((id) => ({ id, mode: chosen.get(id)! }));
  }
  return Object.keys(fill).length ? fill : null;
}

/** The form and the student's Courses as the model reads them; Course names may come from a Source, so they are fenced. */
function contextOf(
  form: BuilderForm,
  courses: {
    handle: string;
    id: string;
    title: string;
    code: string | null;
    archived: boolean;
  }[],
) {
  const onForm = courses.filter((c) => form.courseIds.includes(c.id));
  return [
    "The form as it stands:",
    JSON.stringify(
      {
        name: form.name,
        description: form.description,
        instructions: form.instructions,
        trigger: {
          rhythm: form.trigger.rhythm,
          ...(form.trigger.rhythm === "weekdays"
            ? { weekdays: form.trigger.weekdays }
            : {}),
          time:
            form.trigger.minute === null ? null : timeOf(form.trigger.minute),
        },
        capabilities: form.capabilities,
      },
      null,
      2,
    ),
    onForm.length
      ? `The form's Courses: ${onForm.map((c) => c.handle).join(", ")}.`
      : "The form has no Course yet.",
    ...(courses.length
      ? [
          "The student's Courses, by handle:",
          fenced(
            "courses",
            courses.map(
              (c) =>
                `${c.handle}: ${c.title}${c.code ? ` (${c.code})` : ""}${c.archived ? ", archived: it can stay on the form but not be added" : ""}`,
            ),
          ),
        ]
      : [
          "The student has no Courses yet. An Agent needs one, so tell them to add a Course in nunio first.",
        ]),
  ].join("\n");
}

/**
 * The AI builder panel (ADR-0026 amendment "The builder"): answers the student's latest message on the form as it
 * stands, and fills the form through its one tool. It reads only the form, the conversation and the student's Courses
 * by name; never Sources, Facts, Obligations, Tasks or the Plan. It keeps nothing, saves nothing and starts no Run.
 * Each answer is one model step, metered against the student's Allowance and never an Agent's Budget.
 */
export function createBuilder({
  db,
  delegation,
}: {
  db: PrismaClient;
  delegation: Pick<Delegation, "meter">;
}) {
  return {
    /**
     * Streams the reply's text chunks to `write` and resolves with what to write into the form, or null when the
     * builder only answered. Refused without asking the model when the Allowance is exhausted.
     */
    async answer(
      p: Principal,
      input: { form: BuilderForm; messages: BuilderMessage[] },
      model: Answerer,
      options: {
        signal?: AbortSignal;
        write?: (chunk: UIMessageChunk) => void;
      },
    ): Promise<
      | { status: "ok"; fill: FormFill | null }
      | Extract<Metered<never>, { status: "refused" }>
    > {
      const { form, messages: conversation } = input;
      // Accepted Courses the form may be given, and Archived ones it already has.
      const rows = await withOwner(db, p, (tx) =>
        tx.course.findMany({
          where: {
            status: "accepted",
            OR: [{ archivedAt: null }, { id: { in: form.courseIds } }],
          },
          orderBy: [{ title: "asc" }, { id: "asc" }],
          select: { id: true, title: true, code: true, archivedAt: true },
        }),
      );
      const courses = rows.map((row, i) => ({
        handle: `K${i + 1}`,
        id: row.id,
        title: row.title,
        code: row.code,
        archived: row.archivedAt !== null,
      }));
      const byHandle = new Map(courses.map((c) => [c.handle, c]));
      const turns: ModelMessage[] = conversation.map((m) =>
        m.role === "student"
          ? { role: "user", content: m.text }
          : { role: "assistant", content: m.text },
      );
      const messages: ModelMessage[] = [
        ...turns.slice(0, -1),
        { role: "user", content: contextOf(form, courses) },
        ...turns.slice(-1),
      ];
      const step = {
        messages,
        tools: { fillForm: fillFormTool(courses.map((c) => c.handle)) },
        last: false,
      };
      let called: unknown;
      // Only the reply's text reaches the student; the call is checked before anything is filled.
      const write = (chunk: UIMessageChunk) => {
        if (
          (chunk.type === "tool-input-available" ||
            chunk.type === "tool-input-error") &&
          chunk.toolName === "fillForm"
        )
          called = chunk.input;
        if (chunk.type.startsWith("text-")) options.write?.(chunk);
      };
      const stepped = await retryRateLimited(
        () =>
          delegation.meter(
            p,
            { microUsd: model.estimateMicroUsd(step) },
            (deadline) =>
              definitely(() =>
                model.step(step, {
                  signal: options.signal
                    ? AbortSignal.any([deadline, options.signal])
                    : deadline,
                  write,
                }),
              ),
          ),
        options.signal,
      );
      if (stepped.status === "refused") return stepped;
      return { status: "ok", fill: fillOf(called, form, byHandle) };
    },
  };
}

export type Builder = ReturnType<typeof createBuilder>;
