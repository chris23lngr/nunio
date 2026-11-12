export interface TopicLabel {
  course: string;
  aliases: string[];
  pages: number[];
  optional: boolean;
  figureOnly: boolean;
}
export interface ExtractedTopic {
  course: string;
  key: string;
  value: string;
}
/** Label indices aligned with extracted Topics; null means no match. */
export type Judgement = (number | null)[];

export function scoreTopics(
  labels: TopicLabel[],
  extracted: ExtractedTopic[],
  judgement: Judgement,
) {
  const remaining = new Set(labels.map((_, index) => index));
  let matched = 0;
  let optionalMatched = 0;
  for (const [index, topic] of extracted.entries()) {
    const hit = judgement[index];
    if (hit == null || !remaining.has(hit)) continue;
    if (labels[hit]!.course !== topic.course) continue;
    remaining.delete(hit);
    if (labels[hit]!.optional) optionalMatched++;
    else matched++;
  }
  const required = labels.filter((label) => !label.optional);
  const scored = extracted.length - optionalMatched;
  const figures = labels.flatMap((label, index) =>
    !label.optional && label.figureOnly ? [index] : [],
  );
  const figuresMatched = figures.filter(
    (index) => !remaining.has(index),
  ).length;
  return {
    labelled: required.length,
    extracted: extracted.length,
    scored,
    matched,
    precision: scored ? matched / scored : null,
    recall: required.length ? matched / required.length : null,
    figureOnly: {
      labelled: figures.length,
      matched: figuresMatched,
      recall: figures.length ? figuresMatched / figures.length : null,
    },
  };
}

export function parseJudgement(
  response: string,
  labels: TopicLabel[],
  extracted: ExtractedTopic[],
): Judgement {
  try {
    const parsed = JSON.parse(response);
    if (!parsed || !Array.isArray(parsed.decisions))
      throw new Error("expected decisions array");
    const judgement: Judgement = extracted.map(() => null);
    const seen = new Set<number>();
    for (const decision of parsed.decisions) {
      if (
        !decision ||
        !Number.isInteger(decision.topicId) ||
        decision.topicId < 0 ||
        decision.topicId >= extracted.length ||
        seen.has(decision.topicId)
      )
        throw new Error("unknown or repeated topicId");
      if (
        decision.labelId !== null &&
        (!Number.isInteger(decision.labelId) ||
          decision.labelId < 0 ||
          decision.labelId >= labels.length)
      )
        throw new Error("unknown labelId");
      seen.add(decision.topicId);
      judgement[decision.topicId] = decision.labelId;
    }
    if (seen.size !== extracted.length) throw new Error("missing topicId");
    return judgement;
  } catch (cause) {
    throw new Error(
      "Invalid Topic judgement: expected one JSON decision per topicId with a known labelId (or null)",
      { cause },
    );
  }
}

/** Alternate matched/unmatched decisions, taking turns across decks within each stratum. */
export function calibrationSample<
  T extends { deck: string; labelId: number | null },
>(judgements: T[], n: number, seed: number): T[] {
  let state = seed >>> 0;
  const random = () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 4294967296;
  };
  const shuffle = <V>(items: V[]) => {
    for (let i = items.length - 1; i > 0; i--) {
      const j = Math.floor(random() * (i + 1));
      [items[i], items[j]] = [items[j]!, items[i]!];
    }
    return items;
  };
  const strata = [true, false].map((matched) => {
    const decks = new Map<string, T[]>();
    for (const decision of judgements) {
      if ((decision.labelId !== null) !== matched) continue;
      const items = decks.get(decision.deck) ?? [];
      items.push(decision);
      decks.set(decision.deck, items);
    }
    const queues = [...decks.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([, items]) => shuffle([...items]));
    const ordered: T[] = [];
    while (queues.some((queue) => queue.length)) {
      for (const queue of queues) {
        const item = queue.pop();
        if (item) ordered.push(item);
      }
    }
    return ordered;
  });
  const result: T[] = [];
  for (let i = 0; i < n; i++) {
    const item = strata[i % 2]!.shift() ?? strata[(i + 1) % 2]!.shift();
    if (!item) break;
    result.push(item);
  }
  return result;
}
