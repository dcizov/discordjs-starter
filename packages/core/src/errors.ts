/*
 * Reading a caught value.
 *
 * A caught value is `unknown`, which is accurate: `throw` accepts anything, so
 * a catch clause can hold a string, an object, or nothing at all. Reading
 * `.message` off one is not safe without a check, and the way these call sites
 * used to get around that was annotating it as `any` — which does not fix the
 * problem, it only stops the compiler mentioning it. A thrown string then
 * rendered as `undefined` in a toast instead of being handled.
 *
 * These helpers are the check, and they are deliberately narrow:
 * `errorMessage` returns a message and nothing else, so a call site cannot
 * drift into reading some other property off the same value.
 *
 * They live in their own module, apart from diagnostics.ts, because that one
 * reads process.env to redact credentials — fine in the worker, wrong to ship
 * to a browser for the sake of two string helpers.
 */

/** The text to show a person, for a value that came out of a catch clause. */
export function errorMessage(error: unknown, fallback = "Unknown error") {
  if (error instanceof Error && error.message.trim()) return error.message;
  if (typeof error === "string" && error.trim()) return error;
  return fallback;
}

/** A node-style `code`, e.g. `ENOENT`. Undefined when the value has none. */
export function errorCode(error: unknown): string | undefined {
  if (typeof error !== "object" || error === null || !("code" in error))
    return undefined;
  const code = (error as { code: unknown }).code;
  return typeof code === "string" ? code : undefined;
}
