"use client";

import { cn } from "@nunio/ui";
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "@nunio/ui/components/breadcrumb/breadcrumb";
import { Button } from "@nunio/ui/components/button/button";
import { Input } from "@nunio/ui/components/input/input";
import {
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
} from "@nunio/ui/components/input-group/input-group";
import { Textarea } from "@nunio/ui/components/textarea/textarea";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  CalendarMinus,
  CalendarPlus,
  CalendarSync,
  Goal,
  NotepadText,
  Pencil,
  Plus,
  Save,
  Workflow,
} from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { ReactNode } from "react";
import { useId, useState } from "react";
import { CourseDot } from "@/features/shared/components/course-dot";
import { PageHeader } from "@/features/shared/components/page-header";
import { courseSize, unavailable } from "./agent-course";
import { saveAgent } from "./api/agent-mutations";
import type {
  Agent,
  AgentCapability,
  AgentCourse,
  Capability,
} from "./api/agent-queries";
import { agentCourseQueries, capabilityQueries } from "./api/agent-queries";
import { modeOf } from "./capability-mode";
import { CapabilityMenu } from "./components/capability-menu";
import { EditCapabilitiesSheet } from "./components/edit-capabilities-sheet";
import { EditCoursesSheet } from "./components/edit-courses-sheet";

type Draft = {
  name: string;
  description: string;
  emoji: string;
  instructions: string;
  /** Its Courses as last read, so one that is no longer on offer still shows and can be taken off. */
  courses: AgentCourse[];
  /** Its Capabilities in the capability set's order, each with its mode. */
  capabilities: AgentCapability[];
  /** In USD, as typed. */
  budget: string;
};

/** A blank "Neuer Agent": 🤖 and 5 USD a month. */
const blank: Draft = {
  name: "",
  description: "",
  emoji: "🤖",
  instructions: "",
  courses: [],
  capabilities: [],
  budget: "5",
};
/** The API's cap on a monthly Budget, in USD. */
const maxBudget = 100;

type Saved = Pick<
  Agent,
  | "id"
  | "name"
  | "description"
  | "emoji"
  | "instructions"
  | "courses"
  | "capabilities"
  | "budget"
>;

const draftOf = (agent: Saved): Draft => ({
  name: agent.name,
  description: agent.description,
  emoji: agent.emoji,
  instructions: agent.instructions,
  courses: agent.courses,
  capabilities: agent.capabilities,
  budget: String(agent.budget.limitMicroUsd / 1_000_000),
});

/** A form section: its title, what it is for, and its fields. */
function Section({
  title,
  titleId,
  description,
  descriptionId,
  children,
}: {
  title: string;
  titleId?: string;
  description?: string;
  descriptionId?: string;
  children: ReactNode;
}) {
  return (
    <section aria-label={title} className="flex flex-col">
      <h2 id={titleId} className="text-base font-medium text-base-800">
        {title}
      </h2>
      {description && (
        <p id={descriptionId} className="mt-1 text-xs text-base-500">
          {description}
        </p>
      )}
      <div className="mt-5 flex flex-col gap-8">{children}</div>
    </section>
  );
}

function FieldError({ id, children }: { id: string; children: ReactNode }) {
  return (
    <p id={id} className="mt-2 text-xs text-destructive-600">
      {children}
    </p>
  );
}

/** Each Capability's icon on the form, by the Action it takes. */
const capabilityIcons: Record<Capability["id"], typeof CalendarPlus> = {
  createStudyBlocks: CalendarPlus,
  moveOwnStudyBlocks: CalendarSync,
  moveStudyBlocks: CalendarSync,
  removeOwnStudyBlocks: CalendarMinus,
};

const tabs = [
  { key: "activity", label: "Aktivität", Icon: NotepadText },
  { key: "goal", label: "Auftrag", Icon: Goal },
  { key: "flow", label: "Ablauf", Icon: Workflow },
] as const;

/**
 * An Agent's detail: its Aktivität and its Auftrag, the form a free-text Agent is created and edited with. Speichern
 * saves the whole form; a Run already under way keeps the configuration it started with.
 */
export function AgentFormScreen({
  apiOrigin,
  agent,
}: {
  apiOrigin: string;
  /** Null for a "Neuer Agent" not saved yet. */
  agent: Saved | null;
}) {
  const id = useId();
  const router = useRouter();
  const queryClient = useQueryClient();
  const [draft, setDraft] = useState(() => (agent ? draftOf(agent) : blank));
  // A new Agent has no Runs yet, so it opens on its Auftrag.
  const [tab, setTab] = useState<"activity" | "goal">("goal");
  const [editingCourses, setEditingCourses] = useState(false);
  const [editingCapabilities, setEditingCapabilities] = useState(false);
  const [tried, setTried] = useState(false);
  const offered = useQuery(agentCourseQueries(apiOrigin));
  const capabilitySet = useQuery(capabilityQueries(apiOrigin));
  const save = useMutation(saveAgent(apiOrigin, agent?.id, queryClient));
  const change = (next: Partial<Draft>) => {
    setDraft((current) => ({ ...current, ...next }));
    save.reset();
  };

  const budget = Number(draft.budget);
  const errors = {
    name: draft.name.trim() ? null : "Gib deinem Agenten einen Namen.",
    courses: draft.courses.length ? null : "Wähle mindestens einen Kurs.",
    budget:
      draft.budget.trim() && budget > 0 && budget <= maxBudget
        ? null
        : `Gib ein Budget zwischen 0,01 und ${maxBudget} USD an.`,
  };
  const submit = async () => {
    setTried(true);
    if (Object.values(errors).some(Boolean)) {
      setTab("goal");
      return;
    }
    const saved = await save
      .mutateAsync({
        name: draft.name.trim(),
        description: draft.description.trim(),
        emoji: draft.emoji,
        instructions: draft.instructions.trim(),
        courseIds: draft.courses.map((course) => course.id),
        capabilities: draft.capabilities,
        budgetMicroUsd: Math.round(budget * 1_000_000),
      })
      .catch(() => {
        // Query owns the mutation error, rendered in the header.
      });
    if (saved && !agent) router.replace(`/agents/${saved}`);
  };
  const shown = (key: keyof typeof errors) => (tried ? errors[key] : null);

  return (
    <main className="relative min-h-dvh bg-white font-sans text-base-800">
      <PageHeader>
        <Breadcrumb className="min-w-0">
          <BreadcrumbList className="flex-nowrap">
            <BreadcrumbItem>
              <BreadcrumbLink render={<Link href="/agents" />}>
                Agenten
              </BreadcrumbLink>
            </BreadcrumbItem>
            <BreadcrumbSeparator />
            <BreadcrumbItem className="min-w-0">
              <BreadcrumbPage className="truncate">
                {draft.name.trim() || agent?.name || "Neuer Agent"}
              </BreadcrumbPage>
            </BreadcrumbItem>
          </BreadcrumbList>
        </Breadcrumb>
        <span className="flex-1" />
        {save.isSuccess && (
          <span role="status" className="text-sm text-base-500">
            Gespeichert
          </span>
        )}
        <Button
          disabled={save.isPending}
          onClick={() => void submit()}
          className="pr-2"
        >
          Speichern
          <Save aria-hidden="true" />
        </Button>
      </PageHeader>
      <div className="pt-16">
        <div
          role="tablist"
          aria-label="Agent"
          className="flex items-center gap-4 overflow-x-auto border-b border-base-200 px-6 pb-2"
        >
          {tabs.map(({ key, label, Icon }) => {
            const selected = tab === key;
            return (
              <button
                key={key}
                type="button"
                role="tab"
                id={`${id}-tab-${key}`}
                aria-selected={selected}
                aria-controls={selected ? `${id}-panel` : undefined}
                // Ablauf is not built in v1.
                disabled={key === "flow"}
                onClick={() => key !== "flow" && setTab(key)}
                className={cn(
                  "flex h-6.5 shrink-0 items-center gap-2 rounded-lg pr-2 pl-1.5 text-sm font-medium focus-visible:outline-2 focus-visible:outline-primary-500 disabled:cursor-not-allowed disabled:opacity-50",
                  selected
                    ? "bg-primary-100 text-primary-600"
                    : "text-base-600 hover:bg-base-100",
                )}
              >
                <Icon
                  aria-hidden="true"
                  className={cn(
                    "size-4",
                    selected ? "text-primary-500" : "text-base-500",
                  )}
                />
                {label}
              </button>
            );
          })}
        </div>
        <div
          role="tabpanel"
          id={`${id}-panel`}
          aria-labelledby={`${id}-tab-${tab}`}
        >
          {save.error && (
            <p
              role="alert"
              className="mx-8 mt-6 max-w-[30.5rem] text-sm text-destructive-600"
            >
              {save.error.message}
            </p>
          )}
          {tab === "activity" ? (
            <div className="flex flex-col gap-1 p-8">
              <p className="text-sm font-medium text-base-800">
                Noch keine Läufe
              </p>
              <p className="text-sm text-base-500">
                Sobald dein Agent läuft, siehst du hier, was er getan hat.
              </p>
            </div>
          ) : (
            <form
              id={`${id}-form`}
              noValidate
              onSubmit={(event) => {
                event.preventDefault();
                void submit();
              }}
              className="flex w-full max-w-[34.5rem] flex-col gap-12 p-8"
            >
              <Section title="Allgemein">
                <div className="flex flex-col">
                  <label
                    htmlFor={`${id}-name`}
                    className="text-sm font-medium text-base-800"
                  >
                    Name
                  </label>
                  <Input
                    id={`${id}-name`}
                    className="mt-3"
                    placeholder="Neuer Agent"
                    maxLength={80}
                    value={draft.name}
                    aria-invalid={shown("name") ? true : undefined}
                    aria-describedby={
                      shown("name") ? `${id}-name-error` : undefined
                    }
                    onChange={(event) => change({ name: event.target.value })}
                  />
                  {shown("name") && (
                    <FieldError id={`${id}-name-error`}>
                      {errors.name}
                    </FieldError>
                  )}
                </div>
                <div className="flex flex-col">
                  <label
                    htmlFor={`${id}-description`}
                    className="text-sm font-medium text-base-800"
                  >
                    Beschreibung
                  </label>
                  <Textarea
                    id={`${id}-description`}
                    className="mt-3 min-h-24"
                    maxLength={500}
                    value={draft.description}
                    onChange={(event) =>
                      change({ description: event.target.value })
                    }
                  />
                </div>
              </Section>
              <div aria-hidden="true" className="h-px bg-base-200" />
              <Section
                title="Auftrag"
                titleId={`${id}-instructions-title`}
                description="Was soll der Agent für dich übernehmen?"
                descriptionId={`${id}-instructions-description`}
              >
                <Textarea
                  aria-labelledby={`${id}-instructions-title`}
                  aria-describedby={`${id}-instructions-description`}
                  className="min-h-24"
                  maxLength={4000}
                  value={draft.instructions}
                  onChange={(event) =>
                    change({ instructions: event.target.value })
                  }
                />
              </Section>
              <div aria-hidden="true" className="h-px bg-base-200" />
              <Section
                title="Kontext"
                description="Dein Agent benötigt Kontext, um besser zu verstehen, was er zu tun hat."
              >
                <div className="flex flex-col">
                  <h3 className="text-sm font-medium text-base-800">Kurse</h3>
                  <p className="mt-1 text-xs text-base-500">
                    Alles Vorwissen aus diesen Kursen fließt in das Wissen des
                    Agenten ein.
                  </p>
                  {!!draft.courses.length && (
                    <ul aria-label="Kurse" className="mt-3 flex flex-col gap-3">
                      {draft.courses.map((course) => (
                        <li
                          key={course.id}
                          className="flex items-start gap-2 rounded-lg border border-base-200 px-4 py-3"
                        >
                          <span className="flex pt-1.5">
                            <CourseDot color={course.color} />
                          </span>
                          <span className="flex min-w-0 flex-col gap-0.5">
                            <span className="flex items-center gap-2">
                              <span className="min-w-0 truncate text-sm font-medium text-base-800">
                                {course.title}
                              </span>
                              {unavailable(course, offered.data) && (
                                <span className="shrink-0 rounded-sm bg-base-100 px-1.5 text-xs leading-5 text-base-600">
                                  {unavailable(course, offered.data)}
                                </span>
                              )}
                            </span>
                            <span className="text-sm text-base-500">
                              {courseSize(course)}
                            </span>
                          </span>
                        </li>
                      ))}
                    </ul>
                  )}
                  {shown("courses") && (
                    <FieldError id={`${id}-courses-error`}>
                      {errors.courses}
                    </FieldError>
                  )}
                  <button
                    type="button"
                    onClick={() => setEditingCourses(true)}
                    className="mt-3 flex items-center gap-2 self-start text-sm font-medium text-primary-600 hover:text-primary-700 focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-primary-500"
                  >
                    <Pencil
                      aria-hidden="true"
                      className="size-4 text-primary-500"
                    />
                    Kurse bearbeiten
                  </button>
                </div>
              </Section>
              <div aria-hidden="true" className="h-px bg-base-200" />
              <Section
                title="Fähigkeiten"
                description="Bestimme, was der Agent machen darf und was nicht."
              >
                <div className="flex flex-col">
                  {capabilitySet.error && (
                    <p role="alert" className="text-sm text-destructive-600">
                      {capabilitySet.error.message}
                    </p>
                  )}
                  {!!draft.capabilities.length && capabilitySet.data && (
                    <ul
                      aria-label="Fähigkeiten"
                      className="mb-3 flex flex-col gap-3"
                    >
                      {draft.capabilities.map(({ id: capabilityId, mode }) => {
                        const capability = capabilitySet.data.find(
                          (each) => each.id === capabilityId,
                        );
                        if (!capability) return null;
                        const Icon = capabilityIcons[capabilityId];
                        const shownMode = modeOf(mode);
                        return (
                          <li
                            key={capabilityId}
                            className="flex items-start gap-3 rounded-lg border border-base-200 px-4 py-3"
                          >
                            <span className="flex pt-0.5">
                              <Icon
                                aria-hidden="true"
                                className="size-4 text-primary-500"
                              />
                            </span>
                            <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                              <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
                                <span className="text-sm font-medium text-base-800">
                                  {capability.title}
                                </span>
                                <span
                                  className={cn(
                                    "rounded-sm px-1.5 text-xs leading-5 font-medium",
                                    shownMode.badge,
                                  )}
                                >
                                  {shownMode.label}
                                </span>
                              </span>
                              <span className="text-sm text-base-500">
                                {capability.description}
                              </span>
                            </span>
                            <CapabilityMenu
                              capability={capability}
                              mode={mode}
                              onMode={(next) =>
                                change({
                                  capabilities: draft.capabilities.map(
                                    (each) =>
                                      each.id === capabilityId
                                        ? { id: capabilityId, mode: next }
                                        : each,
                                  ),
                                })
                              }
                              onRemove={() =>
                                change({
                                  capabilities: draft.capabilities.filter(
                                    (each) => each.id !== capabilityId,
                                  ),
                                })
                              }
                            />
                          </li>
                        );
                      })}
                    </ul>
                  )}
                  <button
                    type="button"
                    onClick={() => setEditingCapabilities(true)}
                    className="flex items-center gap-2 self-start text-sm font-medium text-primary-600 hover:text-primary-700 focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-primary-500"
                  >
                    <Plus
                      aria-hidden="true"
                      className="size-4 text-primary-500"
                    />
                    Fähigkeit hinzufügen
                  </button>
                </div>
              </Section>
              <div aria-hidden="true" className="h-px bg-base-200" />
              <Section
                title="Budget"
                description="Wie viel dein Agent pro Monat ausgeben darf."
                descriptionId={`${id}-budget-description`}
              >
                <div className="flex flex-col">
                  <InputGroup>
                    <InputGroupInput
                      type="number"
                      inputMode="decimal"
                      min={0.01}
                      max={maxBudget}
                      step={0.01}
                      aria-label="Budget"
                      aria-describedby={
                        shown("budget")
                          ? `${id}-budget-description ${id}-budget-error`
                          : `${id}-budget-description`
                      }
                      aria-invalid={shown("budget") ? true : undefined}
                      value={draft.budget}
                      onChange={(event) =>
                        change({ budget: event.target.value })
                      }
                    />
                    <InputGroupAddon align="inline-end">
                      USD pro Monat
                    </InputGroupAddon>
                  </InputGroup>
                  {shown("budget") && (
                    <FieldError id={`${id}-budget-error`}>
                      {errors.budget}
                    </FieldError>
                  )}
                </div>
              </Section>
            </form>
          )}
        </div>
      </div>
      <EditCoursesSheet
        open={editingCourses}
        offered={offered.data ?? []}
        loading={offered.isPending}
        error={offered.error?.message}
        selected={draft.courses}
        onSave={(courses) => {
          change({ courses });
          setEditingCourses(false);
        }}
        onClose={() => setEditingCourses(false)}
      />
      <EditCapabilitiesSheet
        open={editingCapabilities}
        offered={capabilitySet.data ?? []}
        loading={capabilitySet.isPending}
        error={capabilitySet.error?.message}
        selected={draft.capabilities}
        onSave={(capabilities) => {
          change({ capabilities });
          setEditingCapabilities(false);
        }}
        onClose={() => setEditingCapabilities(false)}
      />
    </main>
  );
}
