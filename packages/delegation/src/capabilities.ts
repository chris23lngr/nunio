import type { Kind } from "./kinds.js";

/**
 * How an Action Capability is authorised (ADR-0001): `ask` holds no Grant, so every such Action asks for Approval;
 * `automatic` holds a Grant that still asks in cases nunio fixes; `always` holds a Grant that never asks.
 */
export const approvalModes = ["always", "automatic", "ask"] as const;
export type ApprovalMode = (typeof approvalModes)[number];

/** The drawer's sections, in order. Briefings come with its tool. */
export const capabilitySections = {
  studyBlocks: "Lernblöcke",
  tasks: "Aufgaben",
  material: "Lernmaterial",
  notices: "Benachrichtigungen",
} as const;

type Capability = {
  section: keyof typeof capabilitySections;
  title: string;
  description: string;
} & (
  | {
      /** The Action it takes. */
      kind: Kind;
      /** It covers only Study Blocks this Agent created and the student has not moved since (ADR-0001). */
      ownBlocks?: true;
      /** The modes the student may pick, the first being its default when added. */
      modes: readonly [ApprovalMode, ...ApprovalMode[]];
    }
  | {
      /** No Action: it starts an Artifact Run of this kind, so the gate is not involved (#143). */
      artifact: "flashcards" | "practice_set";
      /** None: it is simply on or off (ADR-0001). */
      modes: readonly [];
    }
  | {
      /** No Action: it sends the student a Notice, at most one per Run (#155). */
      notice: true;
      /** None: it is simply on or off (ADR-0001). */
      modes: readonly [];
    }
);

/**
 * Every Capability an Agent can have, in drawer order: the single source for the drawer, the builder and the
 * Templates. Reading the student's material and Plan is never a Capability (ADR-0026).
 */
export const capabilities = {
  createStudyBlocks: {
    section: "studyBlocks",
    title: "Lernblöcke erstellen",
    description: "Neue Lernzeit in freie Zeitfenster eintragen.",
    kind: "studyBlock.create",
    modes: ["automatic", "always", "ask"],
  },
  moveOwnStudyBlocks: {
    section: "studyBlocks",
    title: "Eigene Lernblöcke verschieben",
    description: "Nur Blöcke, die dieser Agent erstellt hat.",
    kind: "studyBlock.move",
    ownBlocks: true,
    modes: ["automatic", "always", "ask"],
  },
  // Blocks the Agent did not create, the student's own included, are always asked (ADR-0001).
  moveStudyBlocks: {
    section: "studyBlocks",
    title: "Lernblöcke verschieben",
    description: "Auch Blöcke, die du oder andere geplant haben.",
    kind: "studyBlock.move",
    modes: ["ask"],
  },
  removeOwnStudyBlocks: {
    section: "studyBlocks",
    title: "Eigene Lernblöcke entfernen",
    description: "Nur Blöcke, die dieser Agent erstellt hat.",
    kind: "studyBlock.remove",
    ownBlocks: true,
    modes: ["automatic", "always", "ask"],
  },
  // An Agent's only Task tool: it never completes or reopens a Task or changes an Estimate (ADR-0022).
  createTasks: {
    section: "tasks",
    title: "Aufgaben erstellen",
    description:
      "Neue Aufgaben in deinen Kursen anlegen, auch zu Prüfungen und Abgaben oder zur Vor- und Nachbereitung.",
    kind: "task.create",
    modes: ["ask", "automatic", "always"],
  },
  // Each starts at most one Artifact Run per Run, for Topics of the Agent's Courses; Drafts and Critiques are never offered.
  createFlashcards: {
    section: "material",
    title: "Karteikarten erstellen",
    description: "Karteikarten zu Themen deiner Kurse erstellen.",
    artifact: "flashcards",
    modes: [],
  },
  createPracticeSets: {
    section: "material",
    title: "Übungsaufgaben erstellen",
    description: "Übungsaufgaben zu Themen deiner Kurse erstellen.",
    artifact: "practice_set",
    modes: [],
  },
  // Plain text to the student's Inbox, announced without its content or the Agent's name (ADR-0014).
  notifyStudent: {
    section: "notices",
    title: "Dich benachrichtigen",
    description:
      "Dir eine kurze Nachricht in deine Inbox schreiben, höchstens eine pro Lauf.",
    notice: true,
    modes: [],
  },
} as const satisfies Record<string, Capability>;
export type CapabilityId = keyof typeof capabilities;
export const capabilityIds = Object.keys(capabilities) as [
  CapabilityId,
  ...CapabilityId[],
];

/** One Capability on an Agent, with its mode; null for one that is no Action, which is simply on. */
export type AgentCapability = { id: CapabilityId; mode: ApprovalMode | null };

/**
 * The Capabilities as given, if each is known, given once, and on a mode it allows, or without one if it allows none;
 * null otherwise.
 */
export function checkCapabilities(
  given: { id: string; mode: string | null }[],
): AgentCapability[] | null {
  const ids = new Set(given.map((c) => c.id));
  if (ids.size !== given.length) return null;
  for (const { id, mode } of given) {
    if (!Object.hasOwn(capabilities, id)) return null;
    const allowed: readonly string[] = capabilities[id as CapabilityId].modes;
    if (mode === null ? allowed.length > 0 : !allowed.includes(mode))
      return null;
  }
  return given as AgentCapability[];
}

/** The Action a Capability takes; null for one that is no Action. */
export const kindOf = (id: CapabilityId): Kind | null => {
  const capability = capabilities[id];
  return "kind" in capability ? capability.kind : null;
};

/** The kinds an Agent holds a Grant for: one for each Action Capability on `always` or `automatic`. */
export const grantedKinds = (held: AgentCapability[]): Kind[] => [
  ...new Set(
    held.flatMap((c) => {
      const kind = kindOf(c.id);
      return kind && c.mode && c.mode !== "ask" ? [kind] : [];
    }),
  ),
];
