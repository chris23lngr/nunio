import type { AgentTrigger } from "./agents.js";
import type { AgentCapability } from "./capabilities.js";

/** Which Courses "Template verwenden" preselects: none, or all accepted, unarchived Courses. */
export type CoursePreselection = "none" | "all_active";

/** A curated starting point for a new Agent (#147). Sets no Model or Budget. */
export type AgentTemplateDefinition = {
  readonly name: string;
  readonly description: string;
  readonly emoji: string;
  readonly instructions: string;
  readonly trigger: AgentTrigger;
  readonly courses: CoursePreselection;
  readonly capabilities: readonly AgentCapability[];
  /** ISO date (YYYY-MM-DD) shown as "Erstellt am …" in the details dialog. */
  readonly createdOn: string;
};

/**
 * The curated v1 Templates, versioned with the code (#147). An Agent created from one is a copy: later changes here
 * never alter existing Agents.
 */
export const agentTemplates = {
  prepareExam: {
    name: "Klausur vorbereiten",
    description: "Plant deine Vorbereitung bis zum Prüfungstag.",
    emoji: "🎯",
    instructions: [
      "Bereite mich auf die nächste Klausur in meinen Kursen vor.",
      "Verteile die Themen bis zum Prüfungstag auf realistische Lernblöcke. Priorisiere Themen, bei denen ich noch unsicher bin, und plane Wiederholungen ein.",
      "Prüfe bei jedem Start meinen Fortschritt und passe den Plan an. Lass meine selbst geplanten Lernblöcke unverändert.",
    ].join("\n\n"),
    trigger: { rhythm: "daily", minute: 6 * 60 },
    courses: "none",
    capabilities: [
      { id: "createStudyBlocks", mode: "automatic" },
      { id: "moveOwnStudyBlocks", mode: "automatic" },
      { id: "removeOwnStudyBlocks", mode: "automatic" },
      { id: "notifyStudent", mode: null },
    ],
    createdOn: "2026-11-19",
  },
  organizeCourse: {
    name: "Kurs organisieren",
    description: "Behält Termine, Themen und deinen Lernplan im Blick.",
    emoji: "📚",
    instructions: [
      "Halte meine Kurse organisiert.",
      "Achte auf neue Termine, Abgaben und Themen. Lege Aufgaben für Abgaben und Termine an, die Vorbereitung brauchen, und plane genug Lernzeit vor ihren Fristen ein.",
      "Wenn etwas nicht mehr in meine Woche passt, sag mir Bescheid.",
    ].join("\n\n"),
    trigger: { rhythm: "daily", minute: 6 * 60 },
    courses: "none",
    capabilities: [
      { id: "createStudyBlocks", mode: "automatic" },
      { id: "moveOwnStudyBlocks", mode: "automatic" },
      { id: "removeOwnStudyBlocks", mode: "automatic" },
      { id: "createTasks", mode: "ask" },
      { id: "notifyStudent", mode: null },
    ],
    createdOn: "2026-11-19",
  },
  createBriefings: {
    name: "Briefings erstellen",
    description: "Gibt dir täglich Updates über deinen Lernfortschritt.",
    emoji: "📧",
    instructions:
      "Fasse jeden Morgen kurz zusammen, was heute für mich ansteht: offene Freigaben, neue Nachrichten, fertiges Lernmaterial und was in meinem Plan als Nächstes kommt.",
    trigger: { rhythm: "daily", minute: 7 * 60 },
    courses: "all_active",
    capabilities: [{ id: "createBriefing", mode: null }],
    createdOn: "2026-11-19",
  },
} as const satisfies Record<string, AgentTemplateDefinition>;

export type TemplateId = keyof typeof agentTemplates;
export const templateIds = Object.keys(agentTemplates) as [
  TemplateId,
  ...TemplateId[],
];

/** Whether `id` is one of the curated Templates in code. */
export const isTemplateId = (id: string): id is TemplateId =>
  Object.hasOwn(agentTemplates, id);
