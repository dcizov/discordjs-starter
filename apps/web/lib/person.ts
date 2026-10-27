"use client";
import { displayName, secondaryName } from "@orbit/core/identity";

/**
 * The dashboard side of the one naming policy.
 *
 * Components hold different shapes of the same person (an economy account, a
 * roster row, a queue request, an account-menu user), so they all funnel their
 * fields through `personFields` and then through the shared resolver in
 * `@orbit/core/identity`. Nothing here decides precedence itself — a nickname
 * shown in a guild is the guild's nickname, and the handle is only printed when
 * it says something the name does not.
 */
export type PersonFields = {
  username?: string | null;
  globalName?: string | null;
  nickname?: string | null;
};

export function personFields(
  fields: PersonFields | undefined,
  storedName?: string | null,
  context: "guild" | "account" = "guild"
) {
  const person = {
    username: fields?.username ?? null,
    globalName: fields?.globalName ?? null,
    nickname: fields?.nickname ?? null,
    storedName: storedName ?? null,
  };
  return {
    name: displayName(person, context),
    secondary: secondaryName(person, context),
  };
}
