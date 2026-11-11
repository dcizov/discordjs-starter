/**
 * The locales the dashboard and bot can be addressed in.
 *
 * This is a leaf module because three consumers need the same list and none of
 * them can import another without a cycle: `config.ts` defines the Zod schema
 * for stored configuration, `types.ts` declares `GuildConfig` (which
 * `config.ts` imports), and the settings page renders the picker. The list used
 * to be written out three times — once as a Zod enum, once as an inline array
 * of options in the settings page, and once loosely as `string` in the
 * template capture schema — which is how a value the schema rejects could be
 * offered in the UI and stored in config.
 *
 * Adding a locale means adding it here, supplying its message catalogue, and
 * accepting it wherever validation happens; the compile-time assertion at the
 * bottom of `config.ts` fails if the schema and `GuildConfig` drift apart.
 */
export const LOCALES = ["en", "de", "fr", "es"] as const;

export type Locale = (typeof LOCALES)[number];

/** Endonyms: each locale named in its own language, which is the convention. */
export const LOCALE_LABELS: Record<Locale, string> = {
  en: "English",
  de: "Deutsch",
  fr: "Français",
  es: "Español",
};

/**
 * Whether a value is a locale this build can render.
 *
 * A predicate rather than an inline `includes`, because `includes` on a
 * widened array does not narrow the argument, so an assignment guarded by it
 * would still not typecheck.
 */
export function isLocale(value: unknown): value is Locale {
  return (
    typeof value === "string" && (LOCALES as readonly string[]).includes(value)
  );
}
