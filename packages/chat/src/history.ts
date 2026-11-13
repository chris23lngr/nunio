/** How many earlier questions and answers the model sees (ADR-0019, "History"). */
export const historyTurns = 10;

type StoredMessage = {
  role: "student" | "assistant";
  /** Null once a Source the message drew on is deleted. */
  text: string | null;
  derivedFrom: readonly string[];
};

/**
 * The last questions and answers of a Chat, oldest first, as the model sees them, and the Sources their answers
 * drew on. A withdrawn answer is left out with its question, and Citation tags are removed because each turn
 * numbers its own.
 */
export function historyFrom(messages: readonly StoredMessage[]) {
  const pairs: { question: string | null; answer: StoredMessage }[] = [];
  for (let i = 1; i < messages.length; i++) {
    const question = messages[i - 1]!;
    const answer = messages[i]!;
    if (question.role === "student" && answer.role === "assistant")
      pairs.push({ question: question.text, answer });
  }
  const kept = pairs
    .slice(-historyTurns)
    .flatMap(({ question, answer }) =>
      question !== null && answer.text !== null
        ? [{ question, answer: answer.text, derivedFrom: answer.derivedFrom }]
        : [],
    );
  return {
    turns: kept.map(({ question, answer }) => ({
      question,
      answer: answer.replace(/\s*\[S\d+\]/g, ""),
    })),
    derivedFrom: [...new Set(kept.flatMap((turn) => turn.derivedFrom))],
  };
}
