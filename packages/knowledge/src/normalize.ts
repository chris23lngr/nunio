/** Case-, width-, apostrophe- and whitespace-insensitive form used for matching across Sources. */
export function normalize(text: string) {
  return text
    .normalize("NFKC")
    .toLocaleLowerCase("de")
    .replace(/[’‘ʼ]/g, "'")
    .replace(/\s+/g, " ")
    .trim();
}
