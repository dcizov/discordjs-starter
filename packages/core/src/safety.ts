import {
  createCipheriv,
  createDecipheriv,
  createHash,
  createHmac,
  randomBytes,
  timingSafeEqual,
} from "node:crypto";
import { BlockList, isIP } from "node:net";
import sanitizeHtml from "sanitize-html";
import type { GuildRole } from "./types";
export const Permissions = {
  Administrator: 8n,
  ManageGuild: 32n,
  ManageRoles: 268435456n,
  ManageChannels: 16n,
  KickMembers: 2n,
  BanMembers: 4n,
  ModerateMembers: 1099511627776n,
  ManageMessages: 8192n,
  MentionEveryone: 131072n,
  ManageWebhooks: 536870912n,
  ManageNicknames: 134217728n,
  ManageExpressions: 1073741824n,
  ManageEvents: 8589934592n,
  ManageThreads: 17179869184n,
  MuteMembers: 4194304n,
  DeafenMembers: 8388608n,
  MoveMembers: 16777216n,
};
export function canManageGuild(g: { owner?: boolean; permissions: string }) {
  try {
    return (
      !!g.owner ||
      (BigInt(g.permissions) &
        (Permissions.Administrator | Permissions.ManageGuild)) !==
        0n
    );
  } catch {
    return false;
  }
}
const forbidden = Object.values(Permissions).reduce((a, b) => a | b, 0n);
export function assertAssignableRole(
  role: GuildRole | undefined,
  botPosition: number,
  guildId: string
) {
  if (!role) throw new Error("This role no longer exists.");
  if (role.id === guildId || role.managed)
    throw new Error("Managed roles and @everyone cannot be self-assigned.");
  if (role.position >= botPosition)
    throw new Error("Move the Orbit role above the roles it manages.");
  if ((BigInt(role.permissions) & forbidden) !== 0n)
    throw new Error("Roles with elevated permissions cannot be self-assigned.");
}
export function planRoleAssignment(input: {
  roles: GuildRole[];
  botPosition: number;
  guildId: string;
  currentIds: string[];
  requestedIds: string[];
  allowedIds: string[];
  prerequisiteIds: string[];
  exclusiveIds: string[];
  maxRoles: number;
  single: boolean;
}) {
  const selected = [...new Set(input.requestedIds)];
  if (selected.some((r) => !input.allowedIds.includes(r)))
    throw new Error("This role is not part of the panel.");
  if (
    selected.some((r) => !input.currentIds.includes(r)) &&
    input.prerequisiteIds.some((r) => !input.currentIds.includes(r))
  )
    throw new Error("You do not have the required prerequisite roles.");
  if (selected.length > (input.single ? 1 : input.maxRoles))
    throw new Error("Too many roles selected.");
  if (selected.filter((r) => input.exclusiveIds.includes(r)).length > 1)
    throw new Error("These roles are mutually exclusive.");
  const exclusiveSelected = selected.some((r) =>
    input.exclusiveIds.includes(r)
  );
  const remove = input.currentIds.filter(
    (r) =>
      (input.allowedIds.includes(r) ||
        (exclusiveSelected && input.exclusiveIds.includes(r))) &&
      !selected.includes(r)
  );
  for (const id of [...selected, ...remove])
    assertAssignableRole(
      input.roles.find((r) => r.id === id),
      input.botPosition,
      input.guildId
    );
  return { add: selected.filter((r) => !input.currentIds.includes(r)), remove };
}
export function assertModeratable(
  actorPosition: number,
  botPosition: number,
  targetPosition: number,
  isOwner: boolean,
  self: boolean
) {
  if (
    isOwner ||
    self ||
    targetPosition >= actorPosition ||
    targetPosition >= botPosition
  )
    throw new Error(
      "You or Orbit cannot moderate a member with an equal or higher role."
    );
}
export function safeText(text: string, max = 1900) {
  return sanitizeHtml(text, { allowedTags: [], allowedAttributes: {} })
    .replace(/@(everyone|here)/gi, "＠$1")
    .replace(/<@([!&]?)(\d+)>/g, "[mention]")
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, "")
    .slice(0, max);
}
export function fingerprint(guildId: string, sourceId: string, itemId: string) {
  return createHash("sha256")
    .update(`${guildId}\0${sourceId}\0${itemId}`)
    .digest("hex");
}
export function verifyWebhook(
  raw: string,
  timestamp: string,
  signature: string,
  secret: string,
  now = Date.now()
) {
  if (!/^\d{10,13}$/.test(timestamp)) return false;
  const t = Number(timestamp) * (timestamp.length === 10 ? 1000 : 1);
  if (Math.abs(now - t) > 300000) return false;
  const expected = createHmac("sha256", secret)
    .update(`${timestamp}.${raw}`)
    .digest("hex");
  const supplied = signature.replace(/^sha256=/, "");
  return (
    /^[a-f0-9]{64}$/i.test(supplied) &&
    timingSafeEqual(Buffer.from(expected, "hex"), Buffer.from(supplied, "hex"))
  );
}
const blocked = new BlockList();
for (const [network, prefix] of [
  ["0.0.0.0", 8],
  ["10.0.0.0", 8],
  ["100.64.0.0", 10],
  ["127.0.0.0", 8],
  ["169.254.0.0", 16],
  ["172.16.0.0", 12],
  ["192.0.0.0", 24],
  ["192.0.2.0", 24],
  ["192.168.0.0", 16],
  ["198.18.0.0", 15],
  ["198.51.100.0", 24],
  ["203.0.113.0", 24],
  ["224.0.0.0", 4],
  ["240.0.0.0", 4],
] as const)
  blocked.addSubnet(network, prefix, "ipv4");
for (const [network, prefix] of [
  ["::", 128],
  ["::1", 128],
  ["fc00::", 7],
  ["fe80::", 10],
  ["ff00::", 8],
  ["2001:db8::", 32],
  ["2001::", 23],
  ["2002::", 16],
] as const)
  blocked.addSubnet(network, prefix, "ipv6");
export function isPublicAddress(ip: string) {
  const mapped = ip.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/i);
  if (mapped) return isPublicAddress(mapped[1]);
  const type = isIP(ip);
  if (!type) return false;
  if (
    type === 6 &&
    !ip.toLowerCase().startsWith("2") &&
    !ip.toLowerCase().startsWith("3")
  )
    return false;
  return !blocked.check(ip, type === 4 ? "ipv4" : "ipv6");
}
export function assertFeedUrl(value: string) {
  const u = new URL(value);
  if (
    u.protocol !== "https:" ||
    u.username ||
    u.password ||
    (u.port && u.port !== "443")
  )
    throw new Error("Feeds must use HTTPS on port 443, without credentials.");
  const host = u.hostname.replace(/^\[|\]$/g, "");
  if (
    host === "localhost" ||
    host.endsWith(".local") ||
    host.endsWith(".internal") ||
    (isIP(host) && !isPublicAddress(host))
  )
    throw new Error("Private and internal feed addresses are not allowed.");
  return u;
}
export function encrypt(value: string, secret: string) {
  const iv = randomBytes(12),
    key = createHash("sha256").update(secret).digest();
  const c = createCipheriv("aes-256-gcm", key, iv);
  const text = Buffer.concat([c.update(value, "utf8"), c.final()]);
  return Buffer.concat([iv, c.getAuthTag(), text]).toString("base64url");
}
export function decrypt(value: string, secret: string) {
  const b = Buffer.from(value, "base64url");
  const d = createDecipheriv(
    "aes-256-gcm",
    createHash("sha256").update(secret).digest(),
    b.subarray(0, 12)
  );
  d.setAuthTag(b.subarray(12, 28));
  return Buffer.concat([d.update(b.subarray(28)), d.final()]).toString();
}

// Compare bytes, not UTF-16 character counts; malformed Unicode must never throw.
export function timingSafeStringEqual(actual: string, expected: string) {
  const a = Buffer.from(actual),
    b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}
