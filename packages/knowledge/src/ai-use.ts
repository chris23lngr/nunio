export const aiUseClasses = ["forbidden", "conditional", "allowed"] as const;
export type AiUseClass = (typeof aiUseClasses)[number];
export const isAiUseClass = (value: string): value is AiUseClass =>
  (aiUseClasses as readonly string[]).includes(value);

/** One AI-use Rule as review shows it: the Correction or entry already merged in. */
export type AiUseRuleItem = {
  value: string;
  uncertainty: string | null;
  disagreement: boolean;
  provenance:
    | { kind: "correction" }
    | { kind: "entry" }
    | {
        kind: "source";
        sourceId: string;
        title: string;
        page: number;
        quote: string;
      };
};

/** Whether nunio may draft or give a Critique for an Obligation; while unknown, nunio asks. */
export type AiUse =
  | { status: "unknown"; reason: "none" | "uncertain" | "disagreement" }
  | {
      status: AiUseClass;
      level: "obligation" | "course";
      /** The rule as its Source words it, for showing; null for the student's own value. A prompt must fence it. */
      text: string | null;
      provenance:
        | { kind: "correction" }
        | { kind: "entry" }
        | { kind: "source"; sourceId: string; title: string; page: number };
    };

/** The Obligation's own rule wins over its Course's; an uncertain or disputed rule is not known. */
export function resolveAiUse(
  obligationRule: AiUseRuleItem | undefined,
  courseRule: AiUseRuleItem | undefined,
): AiUse {
  const level = obligationRule ? "obligation" : "course";
  const rule = obligationRule ?? courseRule;
  if (!rule) return { status: "unknown", reason: "none" };
  if (rule.disagreement) return { status: "unknown", reason: "disagreement" };
  if (rule.uncertainty || !isAiUseClass(rule.value))
    return { status: "unknown", reason: "uncertain" };
  const { provenance } = rule;
  return {
    status: rule.value,
    level,
    ...(provenance.kind === "source"
      ? {
          text: provenance.quote,
          provenance: {
            kind: "source",
            sourceId: provenance.sourceId,
            title: provenance.title,
            page: provenance.page,
          },
        }
      : { text: null, provenance }),
  };
}
