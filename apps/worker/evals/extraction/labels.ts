// Topic labels, one Markdown file per Course (see labels/LEITFADEN.md and ADR-0025).
export interface TopicLabel {
  course: string;
  aliases: string[];
  places: { document: string; pages: number[] }[];
  optional: boolean;
}
export interface CourseDocument {
  id: string;
  sha256: string;
  /** `organisation` documents are expected to yield no Topics. */
  kind: "organisation" | "modul" | "folien";
}
export interface CourseLabels {
  course: string;
  /** In upload order. */
  documents: CourseDocument[];
  topics: TopicLabel[];
}

const kinds: CourseDocument["kind"][] = ["organisation", "modul", "folien"];
const pageList = /^\d+(\s*[–-]\s*\d+)?(\s*,\s*\d+(\s*[–-]\s*\d+)?)*$/;

/** Parses the `Kurs:` line, the `ID | SHA-256 | Art` table and the `Thema | Aliase | Fundstellen | optional` table. */
export function parseCourseLabels(markdown: string): CourseLabels {
  const lines = markdown.split("\n");
  const course = lines
    .find((line) => line.startsWith("Kurs:"))
    ?.slice("Kurs:".length)
    .trim();
  if (!course) throw new Error("missing `Kurs:` line");
  const documents: CourseDocument[] = [];
  const topics: TopicLabel[] = [];
  const names = new Set<string>();
  // Each table's first row is its header; a line outside a table ends it.
  let table = -1,
    header = false;
  lines.forEach((line, index) => {
    const row = line.trim();
    if (!row.startsWith("|")) {
      header = false;
      return;
    }
    if (/^[-:|\s]+$/.test(row)) return;
    if (!header) {
      header = true;
      table++;
      return;
    }
    const fail = (reason: string): never => {
      throw new Error(`line ${index + 1}: ${reason}`);
    };
    const cells = row
      .replace(/^\||\|$/g, "")
      .split("|")
      .map((cell) => cell.trim());
    if (table === 0) {
      if (cells.length !== 3) fail("expected 3 cells");
      const [id, sha256, kind] = cells as [string, string, string];
      if (!id || documents.some((d) => d.id === id))
        fail(`empty or repeated ID "${id}"`);
      if (!/^[0-9a-f]{64}$/.test(sha256)) fail("malformed SHA-256");
      if (!kinds.includes(kind as CourseDocument["kind"]))
        fail(`unknown Art "${kind}"`);
      documents.push({ id, sha256, kind: kind as CourseDocument["kind"] });
      return;
    }
    if (cells.length !== 4) fail("expected 4 cells");
    const [topic, aliases, places, optional] = cells as [
      string,
      string,
      string,
      string,
    ];
    if (!topic) fail("empty Thema");
    const key = topic.toLocaleLowerCase("de");
    if (names.has(key)) fail(`duplicate Thema "${topic}"`);
    names.add(key);
    const aliasList = [topic, ...(aliases ? aliases.split(";") : [])].map((a) =>
      a.trim(),
    );
    if (aliasList.includes("")) fail("empty alias");
    if (optional !== "" && optional !== "ja")
      fail(`expected "ja" or empty, got "${optional}"`);
    topics.push({
      course,
      aliases: aliasList,
      places: places.split(";").map((place) => {
        const [document = "", pages = ""] = place.trim().split(/\s+(.*)/);
        if (!documents.some((d) => d.id === document))
          fail(`unknown document "${document}"`);
        if (!pageList.test(pages)) fail(`unreadable Fundstelle "${place}"`);
        const ranges = pages.split(",").map((range) => {
          const [from, to = from] = range.split(/[–-]/).map(Number) as [
            number,
            number?,
          ];
          if (from < 1 || to < from) fail(`unreadable Fundstelle "${place}"`);
          return [from, to] as const;
        });
        return {
          document,
          pages: ranges.flatMap(([from, to]) =>
            Array.from({ length: to - from + 1 }, (_, i) => from + i),
          ),
        };
      }),
      optional: optional === "ja",
    });
  });
  return { course, documents, topics };
}
