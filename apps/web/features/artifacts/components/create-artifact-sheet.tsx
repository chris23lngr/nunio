"use client";

import type { paths } from "@nunio/api-client";
import { Button } from "@nunio/ui/components/button/button";
import { Checkbox } from "@nunio/ui/components/checkbox/checkbox";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@nunio/ui/components/select/select";
import {
  Sheet,
  SheetBody,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from "@nunio/ui/components/sheet/sheet";
import { Textarea } from "@nunio/ui/components/textarea/textarea";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Ban, CircleAlert } from "lucide-react";
import { useState } from "react";
import type { CourseColor } from "@/features/courses/api/course-queries";
import { courseListQuery } from "@/features/courses/api/course-queries";
import { colors } from "@/features/courses/course-format";
import { createApiClient } from "@/lib/api-client";
import type {
  ArtifactOptions,
  ObligationOption,
  TopicOption,
} from "../api/artifact-options-query";
import { artifactOptionsQuery } from "../api/artifact-options-query";
import type { ArtifactKind, ArtifactSummary } from "../api/artifact-queries";
import { artifactsQuery } from "../api/artifact-queries";
import { kinds, shakyBadge } from "../artifact-kinds";

type ArtifactRequest =
  paths["/api/me/artifacts"]["post"]["requestBody"]["content"]["application/json"];

/** Each kind's card text in the sheet, and what its button says. */
const offered: Record<ArtifactKind, { text: string; action: string }> = {
  practice_set: {
    text: "Fragen zu deinen Themen. Deine Antworten werden bewertet.",
    action: "Übungsset erstellen",
  },
  flashcards: {
    text: "Karten zum Wiederholen, auch als Anki-Export.",
    action: "Karteikarten erstellen",
  },
  draft: {
    text: "Ein erster Entwurf für eine Abgabe, nach deinen Anweisungen.",
    action: "Entwurf erstellen",
  },
  critique: {
    text: "Feedback zu deinem Text oder einem Entwurf für eine Abgabe.",
    action: "Kritik anfordern",
  },
};
/** At most this many Topics per practice set or set of flashcards, as the API allows. */
const maxTopics = 20;
const levels: Record<
  TopicOption["level"],
  { text: string; className: string }
> = {
  shaky: { text: "Unsicher", className: shakyBadge },
  disputed: { text: "Strittig", className: shakyBadge },
  solid: { text: "Sicher", className: "bg-success-50 text-success-800" },
  not_yet_practiced: {
    text: "Noch nicht geübt",
    className: "bg-base-100 text-base-600",
  },
};

/** The Topics chosen until the student changes them: the shaky and disputed ones. */
const preselected = (options: ArtifactOptions | undefined) =>
  (options?.topics ?? [])
    .filter((t) => t.level === "shaky" || t.level === "disputed")
    .slice(0, maxTopics)
    .map((t) => t.id);

/** A Course's color, centred on the line of its title. */
function CourseSwatch({ color }: { color: CourseColor }) {
  return (
    <span
      aria-hidden="true"
      className="size-2.5 shrink-0 self-center rounded-sm"
      style={{ backgroundColor: colors[color].swatch }}
    />
  );
}

function KindChoice({
  kind,
  onChange,
}: {
  kind: ArtifactKind;
  onChange: (kind: ArtifactKind) => void;
}) {
  return (
    <fieldset className="flex flex-col gap-2">
      <legend className="mb-2 text-sm leading-5 font-medium text-base-800">
        Typ
      </legend>
      <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
        {(Object.keys(kinds) as ArtifactKind[]).map((each) => {
          const { label, icon: Icon, color } = kinds[each];
          const picked = each === kind;
          return (
            <label
              key={each}
              className={`relative flex cursor-pointer flex-col gap-1.5 rounded-lg px-4 py-4 shadow-xs outline has-focus-visible:ring-2 has-focus-visible:ring-primary-500 has-focus-visible:ring-offset-4 has-focus-visible:ring-offset-white ${
                picked
                  ? "bg-primary-50 outline-primary-400"
                  : "bg-white outline-base-700/15 hover:bg-base-50"
              }`}
            >
              <span className="flex items-center gap-2">
                <Icon
                  aria-hidden="true"
                  className={`size-4 shrink-0 ${color}`}
                />
                <span className="flex-1 text-sm leading-5 font-medium text-base-800">
                  {label}
                </span>
                <input
                  type="radio"
                  name="artifact-kind"
                  value={each}
                  checked={picked}
                  onChange={() => onChange(each)}
                  aria-label={label}
                  aria-describedby={`artifact-kind-${each}`}
                  className="sr-only"
                />
                {/* Drawn rather than native: its see-through middle takes the card's color. */}
                <span
                  aria-hidden="true"
                  className={`flex size-3.5 shrink-0 items-center justify-center rounded-full border ${
                    picked ? "border-primary-400" : "border-base-500"
                  }`}
                >
                  {picked && (
                    <span className="size-1.5 rounded-full bg-primary-500" />
                  )}
                </span>
              </span>
              <span
                id={`artifact-kind-${each}`}
                className="text-xs leading-4 text-base-500"
              >
                {offered[each].text}
              </span>
            </label>
          );
        })}
      </div>
    </fieldset>
  );
}

function TopicList({
  topics,
  chosen,
  onToggle,
}: {
  topics: TopicOption[];
  chosen: string[];
  onToggle: (id: string) => void;
}) {
  const full = chosen.length >= maxTopics;
  return (
    <fieldset className="flex flex-col gap-2">
      <legend className="sr-only">Themen</legend>
      <div className="flex items-baseline justify-between">
        <span
          aria-hidden="true"
          className="text-sm leading-5 font-medium text-base-800"
        >
          Themen
        </span>
        <span className="text-xs leading-4 text-base-500">
          {chosen.length} ausgewählt · bis zu {maxTopics}
        </span>
      </div>
      <ul className="flex flex-col overflow-clip rounded-lg bg-white shadow-xs outline outline-base-700/15">
        {topics.map((topic) => {
          const on = chosen.includes(topic.id);
          const level = levels[topic.level];
          return (
            <li
              key={topic.id}
              className="border-t border-base-100 first:border-t-0"
            >
              <label
                htmlFor={`artifact-topic-${topic.id}`}
                className="flex cursor-pointer items-center gap-3 px-3 py-2.5"
              >
                <Checkbox
                  id={`artifact-topic-${topic.id}`}
                  checked={on}
                  disabled={!on && full}
                  onCheckedChange={() => onToggle(topic.id)}
                />
                <span className="flex-1 text-sm leading-5 font-medium text-base-800">
                  {topic.title}
                </span>
                <span className="flex w-30 shrink-0 justify-end">
                  <span
                    className={`rounded-sm px-1.5 text-xs leading-5 font-medium ${level.className}`}
                  >
                    {level.text}
                  </span>
                </span>
              </label>
            </li>
          );
        })}
      </ul>
      <p className="text-xs leading-4 text-base-500">
        Themen, bei denen du unsicher bist, sind vorausgewählt.
      </p>
    </fieldset>
  );
}

const obligationKinds: Record<ObligationOption["kind"], string> = {
  assignment: "Aufgabe",
  presentation: "Präsentation",
  thesis: "Hausarbeit",
  other: "Abgabe",
};
const dueDay = new Intl.DateTimeFormat("de-DE", {
  day: "numeric",
  month: "long",
  timeZone: "UTC",
});

function ObligationList({
  obligations,
  picked,
  onPick,
}: {
  obligations: ObligationOption[];
  picked: string | undefined;
  onPick: (id: string) => void;
}) {
  return (
    <fieldset className="flex flex-col gap-2">
      <legend className="mb-2 text-sm leading-5 font-medium text-base-800">
        Abgabe
      </legend>
      <ul className="flex flex-col overflow-clip rounded-lg bg-white shadow-xs outline outline-base-700/15">
        {obligations.map((o) => (
          <li key={o.id} className="border-t border-base-100 first:border-t-0">
            <label className="flex cursor-pointer items-center gap-3 px-3 py-2.5">
              <input
                type="radio"
                name="artifact-obligation"
                checked={o.id === picked}
                onChange={() => onPick(o.id)}
                className="size-3.5 shrink-0 accent-primary-500"
              />
              <span className="flex flex-1 flex-col">
                <span className="text-sm leading-5 font-medium text-base-800">
                  {o.title}
                </span>
                <span className="text-xs leading-4 text-base-500">
                  {obligationKinds[o.kind]}
                  {o.due.date &&
                    ` · Abgabe am ${dueDay.format(new Date(`${o.due.date}T12:00:00Z`))}`}
                </span>
              </span>
            </label>
          </li>
        ))}
      </ul>
    </fieldset>
  );
}

type RuleValue = "allowed" | "conditional" | "forbidden";
const answers: { value: RuleValue; text: string }[] = [
  { value: "allowed", text: "Erlaubt" },
  { value: "conditional", text: "Unter Bedingungen" },
  { value: "forbidden", text: "Nicht erlaubt" },
];

/** Asks for an AI-use Rule nunio does not know, for this Obligation or the whole Course. */
function RuleQuestion({
  answering,
  onAnswer,
}: {
  answering: boolean;
  onAnswer: (level: "obligation" | "course", value: RuleValue) => void;
}) {
  const [level, setLevel] = useState<"obligation" | "course">("obligation");
  const question = "Darf KI für diese Abgabe genutzt werden?";
  return (
    <fieldset
      aria-label={question}
      className="flex flex-col gap-3.5 rounded-lg bg-base-50 p-4 outline outline-base-700/15"
    >
      <div className="flex flex-col gap-1">
        <p className="text-sm leading-5 font-medium text-base-800">
          {question}
        </p>
        <p className="text-sm leading-5 text-base-600">
          Deine Unterlagen sagen dazu nichts. Schau im Modulhandbuch nach oder
          frag deine Lehrperson.
        </p>
      </div>
      <div className="grid grid-cols-3 gap-2">
        {answers.map((answer) => (
          <Button
            key={answer.value}
            variant="outline"
            disabled={answering}
            onClick={() => onAnswer(level, answer.value)}
          >
            {answer.text}
          </Button>
        ))}
      </div>
      <div className="flex flex-wrap items-center gap-4">
        <span className="text-xs leading-4 text-base-500">Gilt für</span>
        {(
          [
            ["obligation", "Diese Abgabe"],
            ["course", "Den ganzen Kurs"],
          ] as const
        ).map(([value, text]) => (
          <label
            key={value}
            className="flex cursor-pointer items-center gap-1.5"
          >
            <input
              type="radio"
              name="artifact-rule-level"
              checked={level === value}
              onChange={() => setLevel(value)}
              className="size-3.5 accent-primary-500"
            />
            <span className="text-sm leading-5 font-medium text-base-800">
              {text}
            </span>
          </label>
        ))}
      </div>
    </fieldset>
  );
}

/** The Obligation's AI-use Rule, where nunio may not simply write: conditions to confirm. */
function AiRule({
  rule,
  refused,
  confirmed,
  onConfirm,
  onChange,
}: {
  rule: ObligationOption["aiUse"];
  /** What nunio will not write where the Rule forbids it. */
  refused: string;
  confirmed: boolean;
  onConfirm: (confirmed: boolean) => void;
  onChange: () => void;
}) {
  if (rule.status === "forbidden")
    return (
      <section
        aria-label="KI-Regel"
        className="flex items-start gap-2.5 rounded-lg bg-destructive-50 p-4 outline outline-destructive-500/30"
      >
        <Ban
          aria-hidden="true"
          className="mt-0.5 size-4 shrink-0 text-destructive-600"
        />
        <div className="flex flex-col gap-1">
          <p className="text-sm leading-5 font-medium text-destructive-800">
            Dein Kurs erlaubt hier keine KI
          </p>
          <p className="text-sm leading-5 text-base-700">
            Darum schreibt nunio {refused}. Üben kannst du trotzdem, mit einem
            Übungsset oder Karteikarten zu den Themen dieses Kurses.
          </p>
          <p className="text-xs leading-4 text-base-500">
            {rule.provenance.kind === "source"
              ? `Aus ${rule.provenance.title}, S. ${rule.provenance.page}`
              : rule.level === "course"
                ? "Laut deiner Angabe für den ganzen Kurs"
                : "Laut deiner Angabe für diese Abgabe"}
            {" · "}
            <button
              type="button"
              onClick={onChange}
              className="font-medium text-primary-600 hover:text-primary-700"
            >
              Ändern
            </button>
          </p>
        </div>
      </section>
    );
  if (rule.status !== "conditional") return null;
  return (
    <section
      aria-label="KI-Regel"
      className="flex flex-col gap-3 rounded-lg bg-warning-50 p-4 outline outline-warning-500/35"
    >
      <div className="flex items-start gap-2.5">
        <CircleAlert
          aria-hidden="true"
          className="mt-0.5 size-4 shrink-0 text-warning-700"
        />
        <div className="flex flex-col gap-1">
          <p className="text-sm leading-5 font-medium text-warning-800">
            KI ist hier nur unter Bedingungen erlaubt
          </p>
          <p className="text-sm leading-5 text-base-700">
            {rule.text
              ? `„${rule.text}“`
              : "Du hast angegeben, dass KI hier nur unter Bedingungen erlaubt ist. Halte dich an die Vorgaben deines Kurses."}
          </p>
          {rule.provenance.kind === "source" && (
            <p className="text-xs leading-4 text-base-500">
              Aus {rule.provenance.title}, S. {rule.provenance.page}
            </p>
          )}
        </div>
      </div>
      <label
        htmlFor="artifact-conditions"
        className="flex cursor-pointer items-center gap-2.5 pl-6.5"
      >
        <Checkbox
          id="artifact-conditions"
          checked={confirmed}
          onCheckedChange={(next) => onConfirm(next === true)}
        />
        <span className="text-sm leading-5 font-medium text-base-800">
          Ich halte mich an diese Bedingungen.
        </span>
      </label>
    </section>
  );
}

const writtenOn = new Intl.DateTimeFormat("de-DE", {
  day: "numeric",
  month: "short",
});

/** What a Critique comments on: the student's own text, or the latest version of one of nunio's drafts. */
function CritiqueOf({
  drafts,
  source,
  onSource,
  ownWork,
  onOwnWork,
  draftId,
  onDraft,
}: {
  drafts: ArtifactSummary[];
  source: "own" | "draft";
  onSource: (source: "own" | "draft") => void;
  ownWork: string;
  onOwnWork: (text: string) => void;
  draftId: string | undefined;
  onDraft: (id: string) => void;
}) {
  const segments = [
    { value: "own", text: "Eigener Text", disabled: false },
    { value: "draft", text: "Entwurf von nunio", disabled: !drafts.length },
  ] as const;
  return (
    <fieldset className="flex flex-col gap-2">
      <legend className="mb-2 text-sm leading-5 font-medium text-base-800">
        Was soll nunio prüfen?
      </legend>
      <div className="flex items-center gap-0.5 self-start rounded-lg bg-base-100 p-0.5">
        {segments.map((segment) => (
          <label
            key={segment.value}
            className={`flex h-6.5 items-center rounded-md px-2.5 text-sm font-medium has-focus-visible:outline-2 has-focus-visible:outline-primary-500 ${
              source === segment.value
                ? "bg-white text-base-800 shadow-sm"
                : "text-base-500"
            } ${segment.disabled ? "cursor-not-allowed opacity-60" : "cursor-pointer"}`}
          >
            <input
              type="radio"
              name="artifact-critique-of"
              className="sr-only"
              checked={source === segment.value}
              disabled={segment.disabled}
              onChange={() => onSource(segment.value)}
            />
            {segment.text}
          </label>
        ))}
      </div>
      {!drafts.length && (
        <p className="text-xs leading-4 text-base-500">
          Noch kein Entwurf zu dieser Abgabe.
        </p>
      )}
      {source === "own" ? (
        <>
          <label htmlFor="artifact-own-work" className="sr-only">
            Dein Text
          </label>
          <Textarea
            id="artifact-own-work"
            value={ownWork}
            maxLength={50_000}
            onChange={(event) => onOwnWork(event.target.value)}
            className="min-h-55"
          />
          <p className="text-xs leading-4 text-base-500">
            Bis zu 50.000 Zeichen. nunio misst deinen Text an den Anforderungen
            der Abgabe.
          </p>
        </>
      ) : (
        <ul className="flex flex-col overflow-clip rounded-lg bg-white shadow-xs outline outline-base-700/15">
          {drafts.map((draft) => (
            <li
              key={draft.id}
              className="border-t border-base-100 first:border-t-0"
            >
              <label className="flex cursor-pointer items-center gap-3 px-3 py-2.5">
                <input
                  type="radio"
                  name="artifact-critique-draft"
                  checked={draft.id === draftId}
                  onChange={() => onDraft(draft.id)}
                  className="size-3.5 shrink-0 accent-primary-500"
                />
                <span className="text-sm leading-5 font-medium text-base-800">
                  {draft.title ?? "Entwurf"} · Version {draft.version} ·{" "}
                  {writtenOn.format(
                    new Date(draft.updatedAt ?? draft.createdAt),
                  )}
                </span>
              </label>
            </li>
          ))}
        </ul>
      )}
    </fieldset>
  );
}

/** Asks nunio for an Artifact: its kind, a Course, and what it is about. */
export function CreateArtifactSheet({
  apiOrigin,
  open,
  initialKind,
  initialCourseId,
  onClose,
  onCreated,
}: {
  apiOrigin: string;
  open: boolean;
  initialKind?: ArtifactKind;
  initialCourseId?: string;
  onClose: () => void;
  onCreated: () => void;
}) {
  const [kind, setKind] = useState<ArtifactKind>(initialKind ?? "practice_set");
  const courses = useQuery(courseListQuery(apiOrigin));
  const offeredCourses = (courses.data?.courses ?? [])
    .filter((course) => !course.archived)
    .sort((a, b) =>
      (b.lastActivityAt ?? "").localeCompare(a.lastActivityAt ?? ""),
    );
  const [pickedCourse, setPickedCourse] = useState(initialCourseId);
  const courseId = offeredCourses.some((c) => c.id === pickedCourse)
    ? pickedCourse
    : offeredCourses[0]?.id;
  const options = useQuery({
    ...artifactOptionsQuery(apiOrigin, courseId ?? ""),
    enabled: open && !!courseId,
  });
  const [chosen, setChosen] = useState<{ courseId: string; ids: string[] }>();
  const topicIds =
    chosen && chosen.courseId === courseId
      ? chosen.ids
      : preselected(options.data);
  const toggle = (id: string) =>
    courseId &&
    setChosen({
      courseId,
      ids: topicIds.includes(id)
        ? topicIds.filter((each) => each !== id)
        : [...topicIds, id],
    });
  const [pickedObligation, setPickedObligation] = useState<{
    courseId: string;
    id: string;
  }>();
  const obligation =
    options.data?.obligations.find(
      (o) =>
        pickedObligation?.courseId === courseId &&
        o.id === pickedObligation?.id,
    ) ?? options.data?.obligations[0];
  const rule = obligation?.aiUse;
  const [instructions, setInstructions] = useState("");
  const [confirmed, setConfirmed] = useState(false);
  /** The student wants to change the answer they gave on the Rule. */
  const [reasking, setReasking] = useState(false);
  const queryClient = useQueryClient();
  const answer = useMutation({
    mutationFn: async ({
      level,
      value,
    }: {
      level: "obligation" | "course";
      value: RuleValue;
    }) => {
      if (!obligation) return;
      const result = await createApiClient(apiOrigin).POST(
        "/api/me/obligations/{id}/ai-use",
        { params: { path: { id: obligation.id } }, body: { level, value } },
      );
      if (!result.data)
        throw new Error("Deine Antwort wurde nicht gespeichert.");
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({
        queryKey: artifactOptionsQuery(apiOrigin, courseId ?? "").queryKey,
      });
      setReasking(false);
    },
  });
  const onTopics = kind === "practice_set" || kind === "flashcards";
  const from = { selection: { courseIds: [courseId ?? ""], sourceIds: [] } };
  const [critiqueOf, setCritiqueOf] = useState<"own" | "draft">("own");
  const [ownWork, setOwnWork] = useState("");
  const [pickedDraft, setPickedDraft] = useState<string>();
  // The list's cache, so its version is known without opening, and so marking, a draft.
  const listed = useQuery({
    ...artifactsQuery(apiOrigin),
    enabled: open && kind === "critique",
  });
  const drafts = (listed.data ?? []).filter(
    (a) =>
      a.kind === "draft" &&
      a.obligationId === obligation?.id &&
      a.status === "ready" &&
      !a.withdrawn &&
      a.version !== null,
  );
  const draft = drafts.find((d) => d.id === pickedDraft) ?? drafts[0];
  const mayWrite =
    rule?.status === "allowed" || (rule?.status === "conditional" && confirmed);
  const request = ((): ArtifactRequest | null => {
    if (!courseId) return null;
    if (onTopics) return topicIds.length ? { kind, topicIds, from } : null;
    if (!obligation || !mayWrite) return null;
    const confirmation =
      rule?.status === "conditional"
        ? { conditionsConfirmed: true as const }
        : {};
    if (kind === "draft")
      return {
        kind,
        obligationId: obligation.id,
        instructions,
        ...confirmation,
        from,
      };
    const of =
      critiqueOf === "own"
        ? ownWork.trim() && { ownWork }
        : draft?.version && { artifactId: draft.id, version: draft.version };
    if (!of) return null;
    return { kind, obligationId: obligation.id, of, ...confirmation, from };
  })();
  const create = useMutation({
    mutationFn: async (body: ArtifactRequest) => {
      const result = await createApiClient(apiOrigin).POST(
        "/api/me/artifacts",
        { body },
      );
      if (result.data) return;
      // The Rule changed since it was loaded: show it as it stands now.
      if (result.response.status === 409) {
        setConfirmed(false);
        await queryClient.invalidateQueries({
          queryKey: artifactOptionsQuery(apiOrigin, courseId ?? "").queryKey,
        });
        throw new Error(
          "Die KI-Regel dieser Abgabe hat sich geändert. Prüfe sie und versuche es noch einmal.",
        );
      }
      throw new Error("Das hat nicht geklappt. Versuche es noch einmal.");
    },
    onSuccess: onCreated,
  });
  return (
    <Sheet open={open} onOpenChange={(next) => !next && onClose()}>
      <SheetContent side="right">
        <SheetHeader>
          <SheetTitle>Artefakt erstellen</SheetTitle>
          <SheetDescription>
            Wähle, was nunio aus deinen Kursunterlagen für dich vorbereiten
            soll.
          </SheetDescription>
        </SheetHeader>
        <SheetBody className="flex flex-col gap-6">
          <KindChoice kind={kind} onChange={setKind} />
          <div className="flex flex-col gap-2">
            <span
              id="artifact-course"
              className="text-sm leading-5 font-medium text-base-800"
            >
              Kurs
            </span>
            <Select
              value={courseId ?? null}
              onValueChange={(value) => setPickedCourse(value ?? undefined)}
              items={offeredCourses.map((c) => ({
                value: c.id,
                label: c.title,
              }))}
            >
              <SelectTrigger aria-label="Kurs" className="w-full">
                <SelectValue>
                  {(value: string | null) => {
                    const c = offeredCourses.find((each) => each.id === value);
                    return (
                      c && (
                        <>
                          <CourseSwatch color={c.color} />
                          <span className="truncate">{c.title}</span>
                        </>
                      )
                    );
                  }}
                </SelectValue>
              </SelectTrigger>
              <SelectContent
                align="start"
                sideOffset={8}
                alignItemWithTrigger={false}
              >
                <SelectGroup>
                  {offeredCourses.map((c) => (
                    <SelectItem key={c.id} value={c.id}>
                      <CourseSwatch color={c.color} />
                      {c.title}
                    </SelectItem>
                  ))}
                </SelectGroup>
              </SelectContent>
            </Select>
          </div>
          {options.error && (
            <p role="alert" className="text-sm text-destructive-600">
              {options.error.message}
            </p>
          )}
          {onTopics && options.data?.topics.length === 0 && (
            <p className="text-sm leading-5 text-base-600">
              Für diesen Kurs kennt nunio noch keine Themen. Lade Unterlagen
              hoch, damit nunio sie findet.
            </p>
          )}
          {!onTopics && options.data?.obligations.length === 0 && (
            <p className="text-sm leading-5 text-base-600">
              Keine offene Abgabe in diesem Kurs.
            </p>
          )}
          {onTopics && !!options.data?.topics.length && (
            <TopicList
              topics={options.data.topics}
              chosen={topicIds}
              onToggle={toggle}
            />
          )}
          {!onTopics && !!options.data?.obligations.length && (
            <ObligationList
              obligations={options.data.obligations}
              picked={obligation?.id}
              onPick={(id) => {
                if (courseId) setPickedObligation({ courseId, id });
                setConfirmed(false);
                setReasking(false);
              }}
            />
          )}
          {!onTopics && (rule?.status === "unknown" || (rule && reasking)) && (
            <RuleQuestion
              answering={answer.isPending}
              onAnswer={(level, value) => answer.mutate({ level, value })}
            />
          )}
          {answer.error && (
            <p role="alert" className="text-sm text-destructive-600">
              {answer.error.message}
            </p>
          )}
          {!onTopics && rule && !reasking && (
            <AiRule
              rule={rule}
              refused={
                kind === "draft" ? "diesen Entwurf nicht" : "keine Kritik dazu"
              }
              confirmed={confirmed}
              onConfirm={setConfirmed}
              onChange={() => setReasking(true)}
            />
          )}
          {kind === "draft" && obligation && rule?.status !== "forbidden" && (
            <div className="flex flex-col gap-2">
              <label
                htmlFor="artifact-instructions"
                className="text-sm leading-5 font-medium text-base-800"
              >
                Anweisungen
              </label>
              <Textarea
                id="artifact-instructions"
                value={instructions}
                maxLength={4000}
                onChange={(event) => setInstructions(event.target.value)}
                className="min-h-28"
              />
              <p className="text-xs leading-4 text-base-500">
                Was soll der Entwurf abdecken? nunio stützt sich auf die
                Unterlagen des Kurses.
              </p>
            </div>
          )}
          {kind === "critique" &&
            obligation &&
            rule?.status !== "forbidden" && (
              <CritiqueOf
                drafts={drafts}
                source={critiqueOf}
                onSource={setCritiqueOf}
                ownWork={ownWork}
                onOwnWork={setOwnWork}
                draftId={draft?.id}
                onDraft={setPickedDraft}
              />
            )}
        </SheetBody>
        <SheetFooter className="flex-row justify-end gap-3 py-4">
          {create.error && (
            <p
              role="alert"
              className="mr-auto self-center text-sm text-destructive-600"
            >
              {create.error.message}
            </p>
          )}
          <Button variant="outline" onClick={onClose}>
            Abbrechen
          </Button>
          <Button
            disabled={!request || create.isPending}
            onClick={() => request && create.mutate(request)}
          >
            {offered[kind].action}
          </Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}
