import { format, isToday, isYesterday } from "date-fns";
import { de } from "date-fns/locale";
import { quoted } from "@/features/chat/proposal-wording";
import type { Briefing, Intervention } from "./api/inbox-queries";

/** "Heute · 08:02", "Gestern · 18:40" or "Mo., 16. Nov. · 07:00"; Briefings join with a comma instead. */
export function when(at: string, separator = " · ") {
  const date = new Date(at);
  const day = isToday(date)
    ? "Heute"
    : isYesterday(date)
      ? "Gestern"
      : format(date, "EEE, d. MMM", { locale: de });
  return `${day}${separator}${format(date, "HH:mm")}`;
}

/** "2 Std." or "1,5 Std.". */
const hours = (minutes: number) =>
  `${(Math.round((minutes / 60) * 10) / 10).toLocaleString("de-DE")} Std.`;

/** What an Action does, such as "Lernblock für Problem sheet 1 verschieben". */
export function actionOf(action: Intervention["action"]) {
  if (!action) return "eine Aktion, die es nicht mehr gibt";
  const { title } = action.work;
  return {
    "studyBlock.create": `Lernblock für ${title} hinzufügen`,
    "studyBlock.move": `Lernblock für ${title} verschieben`,
    "studyBlock.remove": `Lernblock für ${title} entfernen`,
    "task.create": `Aufgabe ${quoted(title)} anlegen`,
    "task.reopen": `Aufgabe ${quoted(title)} wieder öffnen`,
  }[action.kind];
}

export function headingOf({
  kind,
  action,
  title,
  shortMinutes,
  run,
}: Intervention) {
  if (kind === "run_approvals")
    return run?.openApprovals
      ? `${title} braucht deine Freigabe (${run.openApprovals})`
      : `${title} braucht deine Freigabe`;
  if (kind === "shortfall")
    return shortMinutes === null
      ? `Nicht mehr knapp: ${title}`
      : `${hours(shortMinutes)} fehlen für ${title}`;
  if (kind === "disagreement") return `Quellen widersprechen sich zu ${title}`;
  return kind === "approval_expired"
    ? `Freigabe abgelaufen: ${actionOf(action)}`
    : `nunio konnte nicht bestätigen: ${actionOf(action)}`;
}

/** Each kind's label in an Intervention's meta line. */
export const kindAs = {
  run_approvals: "Agent",
  shortfall: "Zeitmangel",
  disagreement: "Widerspruch",
  approval_expired: "Freigabe",
  unconfirmed: "Nicht bestätigt",
} as const;

export const closedAs = {
  acknowledged: "Verstanden",
  dismissed: "Nicht hilfreich",
  lapsed: "Gilt nicht mehr",
} as const;

export const approvalAs = {
  waiting: "Wartet",
  approved: "Freigegeben",
  denied: "Abgelehnt",
  expired: "Abgelaufen",
  withdrawn: "Zurückgezogen",
} as const;

export const artifactStateAs = {
  ready: "Bereit",
  opened: "Geöffnet",
  making: "Wird erstellt",
  failed: "Fehlgeschlagen",
  withdrawn: "Nicht mehr lesbar",
  gone: "Gelöscht",
} as const;

/** "2 Freigaben", "1 Hinweis"; nothing for none. */
const counted = (n: number, one: string, many: string) =>
  n ? [`${n} ${n === 1 ? one : many}`] : [];

/** Who wrote a Briefing, such as "Klausur vorbereiten", or the day nunio wrote it. */
export const briefingName = (b: Briefing) =>
  b.agentName ??
  `Briefing vom ${format(new Date(b.madeAt), "d. MMMM", { locale: de })}`;

/** What a Briefing bundles, such as "2 Freigaben · 3 Hinweise · 2 Artefakte". */
export const briefingSummary = (b: Briefing) =>
  [
    ...(b.agentId ? [] : ["nunio"]),
    ...counted(b.approvals.length, "Freigabe", "Freigaben"),
    ...counted(b.interventions.length, "Hinweis", "Hinweise"),
    ...counted(b.artifacts.length, "Artefakt", "Artefakte"),
    ...counted(b.notices.length, "Nachricht", "Nachrichten"),
  ].join(" · ");
