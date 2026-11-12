// Founder-written Topic labels, one Markdown file per deck (see labels/LEITFADEN.md).
export interface TopicLabel {
  course: string;
  aliases: string[];
  pages: number[];
  optional: boolean;
  figureOnly: boolean;
}

/** Parses the `Kurs:` line and the `Konzept | Aliase | Seiten | optional | nur Abbildung` table. */
export function parseTopicLabels(markdown: string): TopicLabel[] {
  const lines = markdown.split("\n");
  const course = lines
    .find((line) => line.startsWith("Kurs:"))
    ?.slice("Kurs:".length)
    .trim();
  if (!course) throw new Error("missing `Kurs:` line");
  const labels: TopicLabel[] = [];
  const concepts = new Set<string>();
  lines.forEach((line, index) => {
    const row = line.trim();
    if (!row.startsWith("|") || /^[-:|\s]+$/.test(row)) return;
    const cells = row
      .replace(/^\||\|$/g, "")
      .split("|")
      .map((cell) => cell.trim());
    if (cells[0] === "Konzept") return;
    const fail = (reason: string) => {
      throw new Error(`line ${index + 1}: ${reason}`);
    };
    if (cells.length !== 5) fail("expected 5 cells");
    const [concept, aliases, pages, optional, figureOnly] = cells as [
      string,
      string,
      string,
      string,
      string,
    ];
    if (!concept) fail("empty Konzept");
    const key = concept.toLocaleLowerCase("de");
    if (concepts.has(key)) fail(`duplicate Konzept "${concept}"`);
    concepts.add(key);
    const names = [concept, ...(aliases ? aliases.split(";") : [])].map((a) =>
      a.trim(),
    );
    if (names.includes("")) fail("empty alias");
    if (!/^\d+(\s*[–-]\s*\d+)?(\s*,\s*\d+(\s*[–-]\s*\d+)?)*$/.test(pages))
      fail(`unreadable Seiten "${pages}"`);
    for (const flag of [optional, figureOnly])
      if (flag !== "" && flag !== "ja")
        fail(`expected "ja" or empty, got "${flag}"`);
    labels.push({
      course,
      aliases: names,
      pages: pages.split(",").flatMap((range) => {
        const [from, to = from] = range.split(/[–-]/).map(Number) as [
          number,
          number?,
        ];
        return Array.from({ length: to - from + 1 }, (_, i) => from + i);
      }),
      optional: optional === "ja",
      figureOnly: figureOnly === "ja",
    });
  });
  return labels;
}
