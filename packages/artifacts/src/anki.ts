/** A card as Anki gets it: its tags are the names of its Topics. */
export type AnkiCard = {
  id: string;
  front: string;
  back: string;
  tags: string[];
};

// File headers and quoting follow the Anki manual, "Text Files" (docs.ankiweb.net/importing/text-files.html).
const headers = [
  "#separator:Tab",
  "#html:false",
  "#notetype:Basic",
  "#columns:Front\tBack\tTags\tGUID",
  "#tags column:3",
  "#guid column:4",
];

/** A field with the separator, a line break or a quote goes in quotes, with its quotes doubled. */
const field = (text: string) =>
  /[\t\r\n"]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
/** Anki separates tags with spaces, so a Topic name's own spaces become underscores. */
const tag = (name: string) => name.trim().replace(/\s+/g, "_");

/**
 * Flashcards as an Anki text file. Each card's GUID comes from its Artifact and card, so importing an edited version
 * updates the notes instead of duplicating them.
 */
export function toAnkiTsv(artifactId: string, cards: AnkiCard[]): string {
  const rows = cards.map((card) =>
    [
      field(card.front),
      field(card.back),
      field(card.tags.map(tag).join(" ")),
      `nunio-${artifactId}-${card.id}`,
    ].join("\t"),
  );
  return `${[...headers, ...rows].join("\n")}\n`;
}
