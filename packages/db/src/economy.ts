import type { Account, GuildConfig, LedgerEntry } from "@orbit/core";
import { isDemo } from "@orbit/core/environment";
import { and, eq, sql } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { database } from "./client";
import { demoTransaction } from "./demo";
import * as s from "./schema";
/*
 * A discriminated union, not one flat optional-everything shape.
 *
 * The fields a transaction needs depend on which transaction it is: a purchase
 * has an item and a transfer has a recipient, and there is no such thing as a
 * transfer without one. Modelling that as five optional fields meant every
 * read had to assert — `i.toUserId!`, `i.itemId!`, `i.amount!`, six times —
 * and the assertion was checked by nothing. Narrowing on `type` now produces
 * the fields that type actually has.
 */
export type EconomyInput = {
  guildId: string;
  userId: string;
  userName: string;
  /**
   * Avatar hash the bot already holds for this member. Identity is captured
   * where the interaction happens — the dashboard never asks Discord per row.
   */
  userAvatar?: string | null;
  key: string;
  note?: string;
} & (
  | { type: "daily" | "activity" }
  | {
      type: "transfer";
      toUserId: string;
      toUserName?: string;
      toUserAvatar?: string | null;
      amount: number;
    }
  | { type: "purchase"; itemId: string; amount?: number }
);
export type EconomyResult = {
  balance: number;
  amount: number;
  type: EconomyInput["type"];
  itemName?: string;
  roleId?: string;
  replayed?: boolean;
};
/*
 * What the transaction moves. Grants come from configuration; a transfer moves
 * the amount it was given; a purchase costs what the item costs.
 *
 * Written as a switch over the union so that adding a transaction type is a
 * compile error here rather than a silent fall-through to 0. The two call
 * sites that used to spell this out as a nested ternary had already drifted
 * into being two copies.
 */
function amountFor(i: EconomyInput, c: GuildConfig) {
  switch (i.type) {
    case "daily":
      return c.economy.dailyAmount;
    case "activity":
      return c.economy.activityAmount;
    case "transfer":
      return -i.amount;
    case "purchase":
      return -(i.amount ?? 0);
  }
}
const DAY = 86400000;
function checkInput(i: EconomyInput) {
  if (!i.key || i.key.length > 160)
    throw new Error("An idempotency key is required");
  if (
    i.type === "transfer" &&
    (!Number.isSafeInteger(i.amount) || i.amount! <= 0 || i.amount! > 100000000)
  )
    throw new Error(
      "Transfer amount must be a positive whole number below 100,000,001"
    );
  if (i.type === "transfer" && (!i.toUserId || i.toUserId === i.userId))
    throw new Error("Choose another community member");
}
function payload(i: EconomyInput) {
  return JSON.stringify([
    i.type,
    i.userId,
    i.type === "transfer" ? i.toUserId : "",
    i.type === "transfer" ? i.amount : 0,
    i.type === "purchase" ? i.itemId : "",
  ]);
}
function allowed(
  c: GuildConfig,
  i: EconomyInput,
  a: Account,
  now: number,
  lastActivity: string | null
) {
  if (!c.modules.economy) throw new Error("The economy module is disabled");
  if (
    i.type === "daily" &&
    a.lastDaily &&
    now - new Date(a.lastDaily).getTime() < DAY
  )
    throw new Error("Your daily reward is available once every 24 hours");
  if (
    i.type === "activity" &&
    lastActivity &&
    now - new Date(lastActivity).getTime() < c.economy.activityCooldown * 1000
  )
    throw new Error("Activity reward cooldown is still active");
  if (i.type === "transfer" && !c.economy.transferEnabled)
    throw new Error("Transfers are disabled");
}
/**
 * Apply one balance change and return the resulting account state.
 *
 * Callers must pass a stable idempotency `key` (a Discord interaction id, or a
 * dashboard request id). Replaying the same key with the same payload returns the
 * original result with `replayed: true` and writes nothing; reusing a key for a
 * different payload throws instead of guessing which request is real. Both the
 * balance update and the ledger row happen in one transaction, so a crash leaves
 * neither behind.
 *
 * Errors are user-facing (`"Activity reward cooldown is still active"`): they are
 * shown verbatim in Discord and the dashboard, so they must stay free of ids,
 * balances and other users' data.
 */
export async function economyTransaction(
  i: EconomyInput
): Promise<EconomyResult> {
  checkInput(i);
  const p = payload(i),
    now = Date.now(),
    date = new Date(now);
  const opkey = `${i.guildId}:${i.key}`;
  if (isDemo())
    return demoTransaction((d) => {
      const old = d.operations[opkey];
      if (old) {
        if (old.payload !== p)
          throw new Error(
            "Idempotency key was already used for a different operation"
          );
        return { ...old.result, replayed: true };
      }
      const g = d.guilds.find((g) => g.id === i.guildId);
      if (!g || !g.installed) throw new Error("Server not available");
      let a = d.accounts.find(
        (a) => a.guildId === i.guildId && a.userId === i.userId
      );
      if (!a) {
        a = {
          guildId: i.guildId,
          userId: i.userId,
          name: i.userName,
          avatar: i.userAvatar ?? null,
          balance: 0,
          lastDaily: null,
        };
        d.accounts.push(a);
      }
      const lastActivity =
        d.ledger.find(
          (l) =>
            l.guildId === i.guildId &&
            l.userId === i.userId &&
            l.type === "activity"
        )?.createdAt ?? null;
      allowed(g.config, i, a, now, lastActivity);
      let amount = amountFor(i, g.config);
      let item;
      if (i.type === "purchase") {
        item = d.resources.find(
          (r) =>
            r.guildId === i.guildId &&
            r.kind === "shop" &&
            r.id === i.itemId &&
            r.enabled
        );
        if (!item) throw new Error("Shop item not available");
        if (item.data.stock === 0) throw new Error("This item is sold out");
        const invkey = `${i.guildId}:${i.userId}:${item.id}`;
        if (item.data.type === "role" && d.inventory[invkey])
          throw new Error(
            "You already own this role. Use /shop claim to restore it."
          );
        amount = -item.data.price;
      }
      if (a.balance + amount < 0)
        throw new Error("Not enough Stardust for this transaction");
      if (a.balance + amount > 9000000000000)
        throw new Error("Balance limit exceeded");
      if (i.type === "transfer") {
        let b = d.accounts.find(
          (a) => a.guildId === i.guildId && a.userId === i.toUserId
        );
        if (!b) {
          b = {
            guildId: i.guildId,
            userId: i.toUserId,
            name: i.toUserName ?? i.toUserId,
            avatar: i.toUserAvatar ?? null,
            balance: 0,
            lastDaily: null,
          };
          d.accounts.push(b);
        }
        if (b.balance - amount > 9000000000000)
          throw new Error("Recipient balance limit exceeded");
        b.balance -= amount;
        d.ledger.unshift(makeEntry(i, i.toUserId!, -amount, i.userId, date));
      }
      a.name = i.userName;
      if (i.userAvatar) a.avatar = i.userAvatar;
      a.balance += amount;
      if (i.type === "daily") a.lastDaily = date.toISOString();
      if (item) {
        if (item.data.stock > 0) item.data.stock--;
        const invkey = `${i.guildId}:${i.userId}:${item.id}`;
        d.inventory[invkey] = (d.inventory[invkey] ?? 0) + 1;
      }
      d.ledger.unshift(
        makeEntry(
          i,
          i.userId,
          amount,
          i.type === "transfer" ? i.toUserId : null,
          date
        )
      );
      const result = {
        balance: a.balance,
        amount,
        type: i.type,
        ...(item ? { itemName: item.name, roleId: item.data.roleId } : {}),
      };
      d.operations[opkey] = { payload: p, result };
      return result;
    });
  return database().db.transaction(async (tx) => {
    // Serialize each guild's ledger. All writers use the same transaction-scoped lock.
    // This makes cross-account transfers deadlock-free and idempotency checks atomic.
    await tx.execute(
      sql`select pg_advisory_xact_lock(hashtextextended(${i.guildId}, 0))`
    );
    const [old] = await tx
      .select()
      .from(s.economyOperations)
      .where(
        and(
          eq(s.economyOperations.guildId, i.guildId),
          eq(s.economyOperations.key, i.key)
        )
      );
    if (old) {
      if (old.payload !== p)
        throw new Error(
          "Idempotency key was already used for a different operation"
        );
      return { ...old.result, replayed: true } as EconomyResult;
    }
    const [g] = await tx
      .select()
      .from(s.guilds)
      .where(eq(s.guilds.id, i.guildId));
    if (!g || !g.installed) throw new Error("Server not available");
    await tx
      .insert(s.accounts)
      .values({
        guildId: i.guildId,
        userId: i.userId,
        name: i.userName,
        avatar: i.userAvatar ?? null,
      })
      .onConflictDoUpdate({
        target: [s.accounts.guildId, s.accounts.userId],
        // Keep the name current. The avatar is only overwritten when this
        // interaction actually carried one, so an older row never loses a
        // picture because a later call site had no member object.
        set: {
          name: i.userName,
          ...(i.userAvatar ? { avatar: i.userAvatar } : {}),
        },
      });
    const [a] = await tx
      .select()
      .from(s.accounts)
      .where(
        and(eq(s.accounts.guildId, i.guildId), eq(s.accounts.userId, i.userId))
      )
      .for("update");
    allowed(
      g.config,
      i,
      { ...a, lastDaily: a.lastDaily?.toISOString() ?? null },
      now,
      a.lastActivity?.toISOString() ?? null
    );
    let amount = amountFor(i, g.config);
    let item;
    if (i.type === "purchase") {
      [item] = await tx
        .select()
        .from(s.resources)
        .where(
          and(
            eq(s.resources.id, i.itemId),
            eq(s.resources.guildId, i.guildId),
            eq(s.resources.kind, "shop"),
            eq(s.resources.enabled, true)
          )
        )
        .for("update");
      if (!item) throw new Error("Shop item not available");
      if (item.data.stock === 0) throw new Error("This item is sold out");
      const [owned] = await tx
        .select()
        .from(s.inventory)
        .where(
          and(
            eq(s.inventory.guildId, i.guildId),
            eq(s.inventory.userId, i.userId),
            eq(s.inventory.resourceId, item.id)
          )
        );
      if (item.data.type === "role" && owned)
        throw new Error(
          "You already own this role. Use /shop claim to restore it."
        );
      amount = -item.data.price;
    }
    if (a.balance + amount < 0) throw new Error("Insufficient funds");
    if (a.balance + amount > 9000000000000)
      throw new Error("Balance limit exceeded");
    if (i.type === "transfer") {
      // A recipient with no account yet used to be stored under their raw ID,
      // which the leaderboard then rendered as a "name". Store the display name
      // and avatar the caller already has, and repair an ID-shaped old row.
      const recipientUpdate = {
        ...(i.toUserName ? { name: i.toUserName } : {}),
        ...(i.toUserAvatar ? { avatar: i.toUserAvatar } : {}),
      };
      const recipientInsert = tx.insert(s.accounts).values({
        guildId: i.guildId,
        userId: i.toUserId!,
        name: i.toUserName ?? i.toUserId!,
        avatar: i.toUserAvatar ?? null,
      });
      // A caller that knows nothing about the recipient must not overwrite what
      // is already stored, and an empty `set` is not a valid update — so that
      // case leaves the existing row exactly as it was.
      await (Object.keys(recipientUpdate).length
        ? recipientInsert.onConflictDoUpdate({
            target: [s.accounts.guildId, s.accounts.userId],
            set: recipientUpdate,
          })
        : recipientInsert.onConflictDoNothing());
      const [b] = await tx
        .select()
        .from(s.accounts)
        .where(
          and(
            eq(s.accounts.guildId, i.guildId),
            eq(s.accounts.userId, i.toUserId)
          )
        )
        .for("update");
      if (b.balance - amount > 9000000000000)
        throw new Error("Recipient balance limit exceeded");
      await tx
        .update(s.accounts)
        .set({ balance: b.balance - amount })
        .where(
          and(
            eq(s.accounts.guildId, i.guildId),
            eq(s.accounts.userId, i.toUserId)
          )
        );
      await tx.insert(s.ledger).values({
        ...makeEntry(i, i.toUserId, -amount, i.userId, date),
        createdAt: date,
      });
    }
    await tx
      .update(s.accounts)
      .set({
        balance: a.balance + amount,
        ...(i.type === "daily" ? { lastDaily: date } : {}),
        ...(i.type === "activity" ? { lastActivity: date } : {}),
      })
      .where(
        and(eq(s.accounts.guildId, i.guildId), eq(s.accounts.userId, i.userId))
      );
    if (item) {
      if (item.data.stock > 0)
        await tx
          .update(s.resources)
          .set({ data: { ...item.data, stock: item.data.stock - 1 } })
          .where(eq(s.resources.id, item.id));
      await tx
        .insert(s.inventory)
        .values({
          guildId: i.guildId,
          userId: i.userId,
          resourceId: item.id,
          quantity: 1,
        })
        .onConflictDoUpdate({
          target: [
            s.inventory.guildId,
            s.inventory.userId,
            s.inventory.resourceId,
          ],
          set: { quantity: sql`${s.inventory.quantity}+1` },
        });
    }
    const entry = makeEntry(
      i,
      i.userId,
      amount,
      i.type === "transfer" ? i.toUserId : null,
      date
    );
    await tx.insert(s.ledger).values({ ...entry, createdAt: date });
    const result: EconomyResult = {
      balance: a.balance + amount,
      amount,
      type: i.type,
      ...(item ? { itemName: item.name, roleId: item.data.roleId } : {}),
    };
    await tx
      .insert(s.economyOperations)
      .values({ guildId: i.guildId, key: i.key, payload: p, result });
    return result;
  });
}
function makeEntry(
  i: EconomyInput,
  userId: string,
  amount: number,
  counterpartyId: string | null,
  date: Date
): LedgerEntry {
  return {
    id: randomUUID(),
    guildId: i.guildId,
    userId,
    counterpartyId,
    amount,
    type: i.type,
    key: i.key,
    note: (
      i.note ?? `${i.type[0].toUpperCase()}${i.type.slice(1)} transaction`
    ).slice(0, 300),
    createdAt: date.toISOString(),
  };
}
