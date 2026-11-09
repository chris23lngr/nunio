import { randomBytes } from "node:crypto";

const texts = new WeakMap<Untrusted, string>();

/** Text from student material. It never prints itself; only `renderData` reveals it, inside a fence. */
export class Untrusted {
  private constructor() {}
  static of(text: string): Untrusted {
    const untrusted = new Untrusted();
    texts.set(untrusted, text);
    return untrusted;
  }
  /** Part of the interface (knowledge-retrieval.md), so a caller can budget a prompt without reading the text. */
  get length() {
    return texts.get(this)!.length;
  }
  toString() {
    return "[untrusted]";
  }
  toJSON() {
    return "[untrusted]";
  }
}

/** A nonce-fenced data block for a tool result or data message, never for instructions. Fence look-alikes are escaped. */
export function renderData(
  section: string,
  entries: {
    label: string;
    text: Untrusted;
    note?: { prefix: string; text: Untrusted };
  }[],
): string {
  const nonce = randomBytes(8).toString("hex");
  const escapeFence = (text: string) =>
    text.replaceAll("<<<", "‹‹‹").replaceAll(">>>", "›››");
  const body = entries
    .map(({ label, text, note }) =>
      [
        escapeFence(label),
        escapeFence(texts.get(text)!),
        ...(note
          ? [`${note.prefix}${escapeFence(texts.get(note.text)!)}`]
          : []),
      ].join("\n"),
    )
    .join("\n\n");
  return [
    `<<<BEGIN ${section} ${nonce}>>>`,
    body,
    `<<<END ${section} ${nonce}>>>`,
  ].join("\n");
}
