import type { Kind } from "./kinds.js";

/**
 * How an Action Capability is authorised (ADR-0001): `ask` holds no Grant, so every such Action asks for Approval;
 * `automatic` holds a Grant that still asks in cases nunio fixes; `always` holds a Grant that never asks.
 */
export const approvalModes = ["always", "automatic", "ask"] as const;
export type ApprovalMode = (typeof approvalModes)[number];

/** The drawer's sections, in order. Aufgaben, Lernmaterial, Benachrichtigungen and Briefings come with their tools. */
export const capabilitySections = { studyBlocks: "Lernblöcke" } as const;

type Capability = {
  section: keyof typeof capabilitySections;
  title: string;
  description: string;
  /** The Action it takes. */
  kind: Kind;
  /** The modes the student may pick, the first being its default when added. */
  modes: readonly [ApprovalMode, ...ApprovalMode[]];
};

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
    modes: ["automatic", "always", "ask"],
  },
} as const satisfies Record<string, Capability>;
export type CapabilityId = keyof typeof capabilities;
export const capabilityIds = Object.keys(capabilities) as [
  CapabilityId,
  ...CapabilityId[],
];

/** One Capability on an Agent, with its mode. */
export type AgentCapability = { id: CapabilityId; mode: ApprovalMode };

/** The Capabilities as given, if each is known, given once, and on a mode it allows; null otherwise. */
export function checkCapabilities(
  given: { id: string; mode: string }[],
): AgentCapability[] | null {
  const ids = new Set(given.map((c) => c.id));
  if (ids.size !== given.length) return null;
  for (const { id, mode } of given) {
    if (!Object.hasOwn(capabilities, id)) return null;
    const allowed: readonly string[] = capabilities[id as CapabilityId].modes;
    if (!allowed.includes(mode)) return null;
  }
  return given as AgentCapability[];
}

/** The kinds an Agent holds a Grant for: one for each Capability on `always` or `automatic`. */
export const grantedKinds = (held: AgentCapability[]): Kind[] => [
  ...new Set(
    held
      .filter((c) => c.mode !== "ask")
      .map((c) => capabilities[c.id].kind as Kind),
  ),
];
