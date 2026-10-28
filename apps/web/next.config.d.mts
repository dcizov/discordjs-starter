/**
 * Types for `next.config.mjs`, which is JavaScript on purpose (Next loads it
 * before anything is compiled) and therefore has no inferred types.
 *
 * Only the surface the tests and tooling rely on is declared. Widening this is
 * not required — Next validates the real object at runtime and fails loudly on
 * an unknown key, which is the check that matters for the rest of the file.
 */
export type SecurityHeader = { key: string; value: string };

/** One `headers()` entry: a route pattern and the headers applied to it. */
export type HeaderRule = {
  source: string;
  headers: SecurityHeader[];
};

declare const config: {
  /**
   * Rebuilt on every call, so a test can set `NODE_ENV` and read the header
   * that environment would actually send.
   */
  headers: () => Promise<HeaderRule[]>;
  [key: string]: unknown;
};

export default config;
