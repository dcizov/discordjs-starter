/**
 * One naming policy for people, in one place.
 *
 * Before this module every surface chose its own display string, which is how
 * the same person could be "wtFAQ" in the member picker, "w" on the leaderboard
 * and a raw username in the audit log. Discord gives us four different values
 * for one account, and which one is *right* depends on context:
 *
 * | field        | what it is                                              |
 * | ------------ | ------------------------------------------------------- |
 * | `nickname`   | the guild-specific nickname (may be null)               |
 * | `globalName` | the account's global display name (may be null)         |
 * | `username`   | the unique handle, e.g. `wtfaq` (always present)        |
 * | `storedName` | a name recorded earlier (audit rows, legacy accounts)   |
 *
 * Inside a guild the nickname is the best answer, then the global name, then the
 * handle. Outside a guild a nickname does not exist and pretending it is a
 * global identity would be wrong, so it is never consulted there.
 *
 * The secondary line is the handle, and only when it tells the reader something
 * the primary name does not: `Alex` / `alex`, `Alex` / `alex.dev`. A row that
 * would repeat itself renders no second line.
 */
export type PersonNames = {
  userId?: string;
  /** Unique Discord handle (`username`), without the discriminator. */
  username?: string | null;
  /** Discord global display name. */
  globalName?: string | null;
  /** Guild nickname. Only meaningful inside a guild. */
  nickname?: string | null;
  /** A name recorded earlier: audit rows, legacy account rows, chat payloads. */
  storedName?: string | null;
};

export type NameContext = "guild" | "account";

const clean = (value?: string | null) =>
  typeof value === "string" && value.trim() ? value.trim() : null;

/** The name to show, following the documented precedence for the context. */
export function displayName(
  person: PersonNames,
  context: NameContext = "guild"
): string {
  const nickname = clean(person.nickname);
  const globalName = clean(person.globalName);
  const username = clean(person.username);
  const stored = clean(person.storedName);
  if (context === "guild" && nickname) return nickname;
  return globalName ?? username ?? nickname ?? stored ?? "Unknown member";
}

/**
 * The handle, when it disambiguates. Case-insensitive comparison on purpose:
 * "alex" and "Alex" are the same word to a reader and printing both looks like
 * a bug.
 */
export function secondaryName(
  person: PersonNames,
  context: NameContext = "guild"
): string | null {
  const primary = displayName(person, context);
  const username = clean(person.username);
  if (username && username.toLowerCase() !== primary.toLowerCase())
    return username;
  return null;
}

/** Whether the shown name is a nickname that only applies to this guild. */
export function isGuildNickname(
  person: PersonNames,
  context: NameContext = "guild"
): boolean {
  return context === "guild" && !!clean(person.nickname);
}

/**
 * System actors are not people: they have no account, so they must never get an
 * initials bubble that looks like a deleted member.
 */
export function isSystemActor(
  id: string | null | undefined,
  name?: string | null
) {
  if (!id && !name) return true;
  return (
    name === "Orbit" ||
    (!!id &&
      (/^orbit[-_]/.test(id) || /^system:/.test(id) || id === "orbit-worker"))
  );
}
