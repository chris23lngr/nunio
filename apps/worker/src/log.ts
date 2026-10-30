/** Structured JSON on stdout, so a log provider can be added later without code changes. */
export function log(msg: string, fields: Record<string, unknown> = {}): void {
  console.log(JSON.stringify({ msg, ...fields }));
}
