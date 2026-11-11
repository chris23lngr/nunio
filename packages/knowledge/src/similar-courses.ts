/** How alike two titles' trigrams must be for Review to suggest merging their Courses; fixed by the tests beside this. */
const threshold = 0.6;
const romans = ["i", "ii", "iii", "iv", "v", "vi", "vii", "viii", "ix", "x"];

/** Case-, width- and punctuation-free words, with a Roman numeral read as its number, so "Analysis I" is "analysis 1". */
function words(text: string) {
  return text
    .normalize("NFKC")
    .toLocaleLowerCase("de")
    .split(/[^\p{L}\p{N}]+/u)
    .filter(Boolean)
    .map((word) =>
      romans.includes(word) ? String(romans.indexOf(word) + 1) : word,
    );
}

/** Each word's three-character windows, padded as pg_trgm pads them. */
function trigrams(text: string) {
  const grams = new Set<string>();
  for (const word of words(text)) {
    const chars = Array.from(`  ${word} `);
    for (let i = 0; i + 3 <= chars.length; i++)
      grams.add(chars.slice(i, i + 3).join(""));
  }
  return grams;
}

/** Shared trigrams over all trigrams, as pg_trgm's similarity(). */
function similarity(a: string, b: string) {
  const ta = trigrams(a),
    tb = trigrams(b);
  let shared = 0;
  for (const gram of ta) if (tb.has(gram)) shared++;
  const all = ta.size + tb.size - shared;
  return all ? shared / all : 0;
}

const numbers = (title: string) =>
  words(title)
    .filter((word) => /^\p{N}+$/u.test(word))
    .join(" ");

const codeKey = (code: string | null) =>
  code
    ?.normalize("NFKC")
    .toLocaleLowerCase("de")
    .replace(/[^\p{L}\p{N}]/gu, "") || null;

/**
 * Whether two Courses look like one: their codes match once case, spaces and punctuation are ignored, or their titles
 * share enough trigrams. Titles numbered differently, such as Analysis I and II, are a course sequence, never alike.
 */
export function similarCourses(
  a: { title: string; code: string | null },
  b: { title: string; code: string | null },
) {
  const code = codeKey(a.code);
  if (code && code === codeKey(b.code)) return true;
  const [na, nb] = [numbers(a.title), numbers(b.title)];
  if (na && nb && na !== nb) return false;
  return similarity(a.title, b.title) > threshold;
}
