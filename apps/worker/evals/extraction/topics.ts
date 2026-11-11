export interface TopicLabel {
  course: string;
  aliases: string[];
}
const normalize = (text: string) =>
  text.normalize("NFKC").toLocaleLowerCase("de").replace(/\s+/g, " ").trim();

/** One-to-one exact alias matches; duplicate predictions count against precision. */
export function scoreTopics(
  labels: TopicLabel[],
  extracted: { course: string; key: string; value: string }[],
) {
  const remaining = new Set(labels.map((_, index) => index));
  let matched = 0;
  for (const topic of extracted) {
    const hit = [...remaining].find((index) => {
      const label = labels[index]!;
      return (
        label.course === topic.course &&
        label.aliases.some((alias) =>
          [topic.key, topic.value].some(
            (text) => normalize(text) === normalize(alias),
          ),
        )
      );
    });
    if (hit !== undefined) {
      remaining.delete(hit);
      matched++;
    }
  }
  return {
    labelled: labels.length,
    extracted: extracted.length,
    matched,
    precision: extracted.length ? matched / extracted.length : null,
    recall: labels.length ? matched / labels.length : null,
  };
}

/** Values such as "covered" are not identities: locate the raw key through its page quote. */
export function topicKey(
  raw: { key: string; value: string; page: number; quote: string }[],
  value: string,
  citations: { page: number; quote: string }[],
) {
  const matches = raw.filter(
    (item) =>
      item.value === value &&
      citations.some(
        (citation) =>
          citation.page === item.page && citation.quote === item.quote,
      ),
  );
  const keys = [...new Set(matches.map((item) => item.key))];
  return keys.length === 1 ? keys[0] : undefined;
}
