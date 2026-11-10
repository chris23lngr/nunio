/** Case-, width- and whitespace-insensitive form used for matching across Sources. */
export function normalize(text: string) {
  return text
    .normalize("NFKC")
    .toLocaleLowerCase("de")
    .replace(/\s+/g, " ")
    .trim();
}
