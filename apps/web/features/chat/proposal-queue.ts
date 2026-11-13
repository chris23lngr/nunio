import type { ChatUIMessage, SavedProposal } from "./api/chat-queries";

/** The student's decision on one proposal's card. */
export type Decision = "approve" | "deny";

/** One answer's proposals still waiting for the student, decided together (a batch). */
export type Batch = { answerId: string; proposals: SavedProposal[] };

const waiting = (proposal: SavedProposal) =>
  proposal.action?.status === "awaiting_approval" &&
  !!proposal.action.fingerprint;

/** The oldest approved proposal nunio could not confirm took effect, which the student settles before any batch. */
export function oldestUnconfirmed(
  messages: ChatUIMessage[],
): SavedProposal | null {
  for (const message of messages)
    for (const proposal of Object.values(message.metadata?.proposals ?? {}))
      if (proposal.action?.status === "unconfirmed") return proposal;
  return null;
}

/** The oldest answer's waiting proposals, in the order nunio made them; the next answer's wait until these are sent. */
export function oldestBatch(messages: ChatUIMessage[]): Batch | null {
  for (const message of messages) {
    const proposals = Object.values(message.metadata?.proposals ?? {}).filter(
      waiting,
    );
    if (proposals.length > 0) return { answerId: message.id, proposals };
  }
  return null;
}
