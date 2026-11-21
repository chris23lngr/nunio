import { format } from "date-fns";
import { de } from "date-fns/locale";
import { noted, quoted, shortSpan } from "@/features/chat/proposal-wording";
import type { ActivityRun, VerlaufEntry } from "./api/activity-queries";

/** A Run's state in one word: its badge in the list, and its Status card. */
export function stateOf(run: Pick<ActivityRun, "status" | "openApprovals">) {
  if (run.status === "running") return "Läuft gerade";
  if (run.openApprovals > 0) return "Freigabe benötigt";
  if (run.status === "stopped") return "Gestoppt";
  if (run.status === "failed") return "Fehlgeschlagen";
  return "Abgeschlossen";
}

/** Why a Run stopped or failed, as nunio says it; the reasons are those the worker and the API record. */
const reasons: Record<string, string> = {
  paused: "Agent pausiert",
  ended: "Agent beendet",
  budget_exhausted: "Budget aufgebraucht",
  allowance_exhausted: "KI-Kontingent aufgebraucht",
  ai_disabled: "KI vorübergehend abgeschaltet",
  not_entitled: "Kein Pilotzugang",
  deletion_pending: "Dein Konto wird gelöscht",
  model_unavailable: "Modell nicht mehr verfügbar",
  source_deleted: "Eine gelesene Quelle wurde gelöscht",
  run_unpinned: "Seine Kurse waren nicht lesbar",
  gone: "Gelesenes ist nicht mehr da",
  run_ended: "Lauf war schon beendet",
  unconfirmed: "Eine Aktion ist unbestätigt",
  cancelled: "Lauf angehalten",
  model_ended_early: "Das Modell hat vorzeitig aufgehört",
  step_interrupted: "Ein Schritt wurde unterbrochen",
  conversion: "In einen Agenten übernommen",
};

/** The line nunio shows for a Run that stopped or failed, such as "Abgebrochen: Budget aufgebraucht". */
export function endLine(status: "stopped" | "failed", reason: string | null) {
  const why = reason ? reasons[reason] : undefined;
  if (status === "stopped") return why ? `Abgebrochen: ${why}` : "Abgebrochen";
  return `Fehlgeschlagen: ${why ?? "Ein Fehler ist aufgetreten"}`;
}

/** "0,12" for 120.000 micro-USD. */
export const usd = (microUsd: number) =>
  (microUsd / 1_000_000).toLocaleString("de-DE", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });

/** "45 Sek.", "12 Min." or "1 Std. 5 Min." between two moments. */
export function duration(from: Date, to: Date) {
  const seconds = Math.max(
    0,
    Math.round((to.getTime() - from.getTime()) / 1000),
  );
  if (seconds < 60) return `${seconds} Sek.`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes} Min.`;
  const rest = minutes % 60;
  return `${Math.floor(minutes / 60)} Std.${rest ? ` ${rest} Min.` : ""}`;
}

/** "Mi., 19. Nov., 14:02". */
export const startedAt = (at: string) =>
  format(new Date(at), "EEE, d. MMM, HH:mm", { locale: de });

/** "19. November 2026, 14:02". */
export const dated = (at: string) =>
  format(new Date(at), "d. MMMM yyyy, HH:mm", { locale: de });

/** "14:02:05". */
export const timeOf = (at: string) => format(new Date(at), "HH:mm:ss");

type ActionEntry = Extract<VerlaufEntry, { type: "action" }>;
type ApprovalEntry = Extract<VerlaufEntry, { type: "approval" }>;

/** What each kind of Action does, before and after it happened: an Approval card's title, and a decided one's entry. */
export const kinds: Record<
  ApprovalEntry["action"]["kind"],
  { asked: string; done: string }
> = {
  "studyBlock.create": {
    asked: "Lernblock erstellen",
    done: "Lernblock erstellt",
  },
  "studyBlock.move": {
    asked: "Lernblock verschieben",
    done: "Lernblock verschoben",
  },
  "studyBlock.remove": {
    asked: "Lernblock entfernen",
    done: "Lernblock entfernt",
  },
  "task.create": { asked: "Aufgabe anlegen", done: "Aufgabe angelegt" },
  "task.reopen": {
    asked: "Aufgabe wieder öffnen",
    done: "Aufgabe wieder geöffnet",
  },
};

/** What each Capability's tool does, before and after it happened. */
const actions: Record<string, { asked: string; done: string }> = {
  createStudyBlocks: {
    asked: "Lernblock erstellen",
    done: "Lernblock erstellt",
  },
  moveOwnStudyBlocks: {
    asked: "Lernblock verschieben",
    done: "Lernblock verschoben",
  },
  moveStudyBlocks: {
    asked: "Lernblock verschieben",
    done: "Lernblock verschoben",
  },
  removeOwnStudyBlocks: {
    asked: "Lernblock entfernen",
    done: "Lernblock entfernt",
  },
  createTasks: { asked: "Aufgabe anlegen", done: "Aufgabe angelegt" },
};

/** Why the gate refused an Action, as the Verlauf names it. */
const refusals: Record<string, string> = {
  invalid: "Ungültige Angaben, nichts wurde gefragt",
  run_cap: "Limit dieses Laufs erreicht",
  open_approvals_cap: "Zu viele offene Freigaben",
  run_ended: "Der Lauf war schon beendet",
  out_of_scope: "Keine Arbeit seiner Kurse",
  no_capability: "Dazu hat er keine Fähigkeit",
  locked: "Der Block ist gesperrt",
  started: "Der Block hat schon begonnen",
  past: "Liegt in der Vergangenheit",
  protected_time: "Überschneidet deine Geschützte Zeit",
  fixed_event: "Überschneidet einen festen Termin",
  study_block: "Überschneidet einen anderen Lernblock",
  not_owner: "Die Arbeit oder der Block ist weg",
  gone: "Ein Thema ist nicht mehr da",
  nothing_open: "Nichts Offenes zum Bündeln",
  paused: "Agent pausiert",
  ended: "Agent beendet",
  restricted: "Nicht erlaubt",
  approval_denied: "Von dir abgelehnt",
  approval_expired: "Freigabe abgelaufen",
  approval_withdrawn: "Agent pausiert oder beendet, bevor du entschieden hast",
  approval_mismatch: "Hat sich seit der Frage geändert",
};

/** One Verlauf entry in words: what happened, and the details under it. */
export function describeEntry(entry: VerlaufEntry): {
  title: string;
  details: string[];
} {
  switch (entry.type) {
    case "start":
      return {
        title:
          entry.trigger === "manual"
            ? "Von dir mit „Jetzt starten“ gestartet"
            : "Zur geplanten Zeit gestartet",
        details: [],
      };
    case "read": {
      const done = [
        ...(entry.plan ? ["den Plan gelesen"] : []),
        ...(entry.approvals ? ["deine Freigaben gelesen"] : []),
        ...(entry.inbox ? ["die Inbox gelesen"] : []),
        ...(entry.courses.length
          ? [
              `${entry.courses.length} ${entry.courses.length === 1 ? "Kurs" : "Kurse"} gelesen`,
            ]
          : []),
        ...(entry.sources.length
          ? [
              `${entry.sources.length} ${entry.sources.length === 1 ? "Quelle" : "Quellen"} aufgerufen`,
            ]
          : []),
      ];
      const named = (list: { title: string | null }[]) =>
        list.map((item) => item.title ?? "gelöscht").join(", ");
      return {
        title: done.length
          ? `Hat ${done.length > 1 ? `${done.slice(0, -1).join(", ")} und ${done.at(-1)}` : done[0]}`
          : "Hat gesucht und nichts gefunden",
        details: [
          ...(entry.courses.length ? [`Kurse: ${named(entry.courses)}`] : []),
          ...(entry.sources.length ? [`Quellen: ${named(entry.sources)}`] : []),
        ],
      };
    }
    case "action":
      return describeAction(entry);
    case "artifact":
      return describeArtifact(entry);
    case "notice":
      return describeNotice(entry);
    case "briefing":
      return describeBriefing(entry);
    case "approval":
      return describeApproval(entry);
    case "end":
      return {
        title:
          entry.status === "done"
            ? "Abgeschlossen"
            : endLine(entry.status, entry.reason),
        details: [],
      };
  }
}

/** The work an Action was for, its Course and when, as one line; gone only once deleted. */
function workLine(action: NonNullable<ActionEntry["action"]>) {
  return [
    // Gone only once deleted; an Archived Course's work is still named.
    action.work
      ? action.work.title
        ? quoted(action.work.title)
        : "Ohne Titel"
      : "gelöscht",
    // A new Task names the Obligation it counts toward.
    ...(action.work?.obligation
      ? [`für ${quoted(action.work.obligation)}`]
      : []),
    ...(action.work?.course ? [action.work.course] : []),
    ...(action.start && action.end
      ? [shortSpan({ start: action.start, end: action.end })]
      : []),
  ].join(" · ");
}

function describeAction(entry: ActionEntry) {
  const named = actions[entry.capability] ?? {
    asked: "Unbekannte Aktion",
    done: "Unbekannte Aktion ausgeführt",
  };
  const title = {
    done: named.done,
    awaiting_approval: `Freigabe angefragt: ${named.asked}`,
    refused: `Abgelehnt: ${named.asked}`,
    failed: `Fehlgeschlagen: ${named.asked}`,
    unconfirmed: `Unbestätigt: ${named.asked}`,
  }[entry.outcome];
  return {
    title,
    details: [
      ...(entry.action ? [workLine(entry.action)] : []),
      ...(entry.refusal
        ? [`Grund: ${refusals[entry.refusal] ?? entry.refusal}`]
        : []),
      ...entry.brokenPreferences.map(
        (broken) => `Immer erlaubt, obwohl: ${noted[broken]}`,
      ),
    ],
  };
}

/** The flashcards or practice set a call started, for its Topics, or why none started. */
function describeArtifact(entry: Extract<VerlaufEntry, { type: "artifact" }>) {
  const named = entry.kind === "flashcards" ? "Karteikarten" : "Übungsaufgaben";
  return {
    title:
      entry.outcome === "started"
        ? `${named} gestartet`
        : `Nicht gestartet: ${named}`,
    details: [
      ...(entry.topics.length
        ? [
            `Themen: ${entry.topics.map((topic) => topic.title ?? "gelöscht").join(", ")}`,
          ]
        : []),
      ...(entry.refusal
        ? [
            `Grund: ${entry.refusal === "invalid" ? "Ungültige Angaben, nichts wurde gestartet" : (refusals[entry.refusal] ?? entry.refusal)}`,
          ]
        : []),
    ],
  };
}

/** The Notice a call sent, read in the Inbox and never shown here, or why none was sent. */
function describeNotice(entry: Extract<VerlaufEntry, { type: "notice" }>) {
  if (entry.outcome === "sent")
    return {
      title: "Nachricht an dich gesendet",
      details: ["In deiner Inbox"],
    };
  return {
    title: "Nicht gesendet: Nachricht",
    details: entry.refusal
      ? [
          `Grund: ${entry.refusal === "invalid" ? "Ungültiger Text, nichts wurde gesendet" : (refusals[entry.refusal] ?? entry.refusal)}`,
        ]
      : [],
  };
}

/** The Briefing a call wrote, read in the Inbox and never shown here, or why none was written. */
function describeBriefing(entry: Extract<VerlaufEntry, { type: "briefing" }>) {
  if (entry.outcome === "written")
    return {
      title: "Briefing erstellt",
      details: ["In deiner Inbox"],
    };
  return {
    title: "Kein Briefing erstellt",
    details: entry.refusal
      ? [
          `Grund: ${entry.refusal === "invalid" ? "Ungültige Angaben, nichts wurde erstellt" : (refusals[entry.refusal] ?? entry.refusal)}`,
        ]
      : [],
  };
}

/**
 * An Approval the student decided, that expired unanswered or that was withdrawn as the Agent was Paused or Ended, and
 * what became of an approved one.
 */
function describeApproval(entry: ApprovalEntry) {
  const named = kinds[entry.action.kind];
  const title =
    entry.decision === "denied"
      ? `Von dir abgelehnt: ${named.asked}`
      : entry.decision === "expired"
        ? `Freigabe abgelaufen: ${named.asked}`
        : entry.decision === "withdrawn"
          ? `Freigabe zurückgezogen: ${named.asked}`
          : {
              done: `Von dir freigegeben: ${named.done}`,
              refused: `Freigegeben, nicht ausgeführt: ${named.asked}`,
              failed: `Freigegeben, fehlgeschlagen: ${named.asked}`,
              unconfirmed: `Freigegeben, unbestätigt: ${named.asked}`,
              pending: `Freigegeben, wird ausgeführt: ${named.asked}`,
            }[entry.outcome ?? "pending"];
  return {
    title,
    details: [
      workLine(entry.action),
      ...(entry.refusal
        ? [`Grund: ${refusals[entry.refusal] ?? entry.refusal}`]
        : []),
    ],
  };
}
