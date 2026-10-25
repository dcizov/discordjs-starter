/** Configuration/synced-metadata guidance, deliberately NOT a live readiness audit. */
import { isCommunityChannel } from "./community";
import type { DashboardData, ModuleKey, Resource } from "./types";
import {
  botGuildPermissions,
  permissionState,
  roleAssignmentIssue,
  type PermissionName,
} from "./permissions";
export type SetupState =
  "paused" | "needs-setup" | "not-verified" | "configured";
export type ModuleSetup = { state: SetupState; label: string; detail: string };
type Context = Pick<
  DashboardData,
  "guild" | "resources" | "integrations" | "health" | "demo"
>;
const result = (state: SetupState, detail: string): ModuleSetup => ({
  state,
  label: {
    paused: "Paused",
    "needs-setup": "Needs setup",
    "not-verified": "Not verified",
    configured: "Configured",
  }[state],
  detail,
});
export function sourceSetupIssue(source: Resource) {
  if (source.data.adapter === "webhook") return null; // Signing credentials are managed by the protected server endpoint, not exposed in this snapshot.
  if (source.data.adapter === "steam")
    return Number.isInteger(source.data.appId) && source.data.appId > 0
      ? null
      : "Set a Steam application ID.";
  if (!source.data.url)
    return "Add a verified RSS/Atom URL or configure a signed incoming webhook. No default publisher feed or scraping is assumed.";
  return null;
}
export function moduleSetup(data: Context, module: ModuleKey): ModuleSetup {
  const { guild } = data;
  if (!guild.installed)
    return result(
      "needs-setup",
      "Install Orbit before configuring live actions. Demo never installs a bot."
    );
  if (!guild.config.modules[module])
    return result(
      "paused",
      "Configuration is preserved. Enable this module explicitly when you want it to run."
    );
  const enabled = (kind: Resource["kind"]) =>
    data.resources.filter((item) => item.kind === kind && item.enabled);
  const checkGuild = (names: PermissionName[]) =>
    permissionState(botGuildPermissions(guild.roles), names);
  const destination = (id: string | undefined) => {
    const channel = guild.channels.find(
      (item) => item.id === id && item.type === "text"
    );
    return channel
      ? permissionState(channel.permissionBits, [
          "ViewChannel",
          "SendMessages",
          "EmbedLinks",
        ])
      : "missing";
  };
  const checked = (
    states: Array<"present" | "missing" | "unknown">,
    detail: string
  ) =>
    states.includes("missing")
      ? result(
          "needs-setup",
          "A configured destination or bot permission is missing. Check Channels & roles → Permissions, including channel/category overwrites and role hierarchy."
        )
      : states.includes("unknown")
        ? result(
            "not-verified",
            data.demo
              ? "This older sample has no permission snapshot; demo does not audit Discord or require a bot login."
              : "Permission snapshots are missing. Start the bot and wait for sync; existing settings are not proof of live access."
          )
        : result("configured", detail);
  if (module === "polls" || module === "announcements") {
    const candidates = guild.channels.filter((c) =>
      isCommunityChannel(c, data.demo)
    );
    if (!candidates.length)
      return result(
        guild.channels.some((c) => c.type === "text")
          ? "not-verified"
          : "needs-setup",
        "Choose an ordinary server text channel for each draft. Start Orbit and wait for a channel sync if supported community destinations are unknown. New modules never send merely because they are enabled."
      );
    const permissions: PermissionName[] =
      module === "polls"
        ? ["ViewChannel", "SendMessages", "SendPolls", "ReadMessageHistory"]
        : ["ViewChannel", "SendMessages", "EmbedLinks"];
    const states = candidates.map((c) =>
      permissionState(c.permissionBits, permissions)
    );
    return states.includes("present")
      ? result(
          "configured",
          "At least one synced destination has the feature permissions. Select a destination in each draft; fresh manager membership and channel permissions are rechecked at execution. This is not proof of publication."
        )
      : checked(
          states,
          "Destination metadata is available; execution is not verified."
        );
  }
  if (module === "roles") {
    const panels = enabled("panel");
    if (!panels.length)
      return result(
        "needs-setup",
        "Create an enabled panel, select safe community roles and a text destination, preview it, then explicitly publish it."
      );
    if (
      panels.some((panel) =>
        panel.data.roleIds.some((id: string) =>
          roleAssignmentIssue(
            guild.roles.find((role) => role.id === id),
            guild.botRolePosition,
            guild.id
          )
        )
      )
    )
      return result(
        "needs-setup",
        "A panel includes a protected/missing role. Choose only non-managed, non-elevated roles below Orbit; Administrator cannot bypass this policy."
      );
    return checked(
      [
        checkGuild(["ManageRoles"]),
        ...panels.map((panel) => destination(panel.data.channelId)),
      ],
      "Panel configuration and synced posting/role bits are present. Explicit publication and runtime member prerequisites/limits still apply; reaction mode has additional permissions."
    );
  }
  if (module === "deals") {
    if (!data.demo && !data.integrations?.itad)
      return result(
        "needs-setup",
        "Configure ITAD_API_KEY on the server, then create a subscription and choose a text destination. Do not put API keys in a form or browser bundle."
      );
    const subscriptions = enabled("deal");
    if (!subscriptions.length)
      return result(
        "needs-setup",
        "Create an enabled deal subscription with a destination and evidence/price thresholds. Search/title selections do not themselves enable automatic posts."
      );
    return checked(
      subscriptions.map((item) => destination(item.data.channelId)),
      "Subscription configuration and synced destination bits are present. The worker, regional offers and popularity/review evidence decide delivery; a successful search is not a delivery test."
    );
  }
  if (module === "news") {
    const sources = enabled("source");
    if (!sources.length)
      return result(
        "needs-setup",
        "Add a configured Steam/RSS/Atom source or signed webhook, then a direct destination or routing rule."
      );
    const missing = sources.filter(sourceSetupIssue);
    if (missing.length)
      return result(
        "needs-setup",
        `${missing.length} enabled source${missing.length === 1 ? " needs" : "s need"} configuration. Blizzard/Wowhead/Mojang names are starters, not automatic integrations. Use the Needs setup source filter.`
      );
    if (sources.some((source) => source.data.health === "degraded"))
      return result(
        "not-verified",
        "A source's last worker check failed. Use Test source and delivery history for the actual diagnostic; retries and deduplication stay enabled."
      );
    const states = sources.flatMap((source) => {
      const routes = enabled("route").filter((route) =>
        route.data.sourceIds.includes(source.id)
      );
      const ids = [
        ...new Set(
          [
            source.data.channelId,
            ...routes.map((route) => route.data.channelId),
          ].filter(Boolean)
        ),
      ] as string[];
      return ids.length ? ids.map(destination) : ["missing" as const];
    });
    return checked(
      states,
      "Sources and direct/routed destinations are configured. Test source and inspect delivery history; webhook signing credentials are not audited or exposed here. No proprietary site is scraped."
    );
  }
  if (module === "music") {
    if (!data.demo && !data.integrations?.lavalink)
      return result(
        "needs-setup",
        "Configure the server-side Lavalink URL/password pair and start the bot + music backend. Provider lookup, Discord handshake and audio playback are separate stages."
      );
    const voice = guild.channels.filter((channel) => channel.type === "voice");
    if (!voice.length)
      return result(
        "needs-setup",
        "Choose a normal server voice channel. Stage channels are unsupported; use a non-full, non-NSFW channel for the first test."
      );
    if (
      !voice.some(
        (channel) =>
          permissionState(channel.permissionBits, [
            "ViewChannel",
            "Connect",
            "Speak",
          ]) === "present"
      )
    )
      return checked(
        voice.map((channel) =>
          permissionState(channel.permissionBits, [
            "ViewChannel",
            "Connect",
            "Speak",
          ])
        ),
        "Choose an accessible normal voice channel."
      );
    if (
      !data.demo &&
      data.health.find((health) => health.name === "Music backend")?.status !==
        "healthy"
    )
      return result(
        "not-verified",
        "Lavalink is configured, but a healthy backend connection is not reported. Check bot/backend logs or the read-only doctor. This does not diagnose gateway permissions or prove playback."
      );
    return result(
      "configured",
      "A normal voice channel has synced View Channel/Connect/Speak bits. Join it in Discord; same-channel/DJ restrictions still apply. Gateway events, player creation and actual audio require an authorized live test."
    );
  }
  if (module === "economy") {
    const roleItems = enabled("shop").filter(
      (item) => item.data.type === "role"
    );
    if (
      roleItems.some((item) =>
        roleAssignmentIssue(
          guild.roles.find((role) => role.id === item.data.roleId),
          guild.botRolePosition,
          guild.id
        )
      )
    )
      return result(
        "needs-setup",
        "An enabled role reward is missing or protected. Item-only purchases, daily rewards and transfers do not need Manage Roles; role claims do and must respect hierarchy."
      );
    return checked(
      roleItems.length ? [checkGuild(["ManageRoles"])] : [],
      "Daily rewards use a rolling 24-hour cooldown, not midnight reset. Transfers/purchases use atomic, guild-scoped ledger entries; activity rewards require qualifying visible message content and their configured cooldown. No real-money gambling."
    );
  }
  const required = new Set<PermissionName>();
  for (const rule of enabled("rule")) {
    if (rule.data.action !== "delete") required.add("ModerateMembers");
  }
  return checked(
    required.size ? [checkGuild([...required])] : [],
    "Manual warn/timeout/kick/ban and channel purge each have their own actor + bot permissions. Both must outrank targets; owner, self, bot and timeout-protected administrators stay protected. Message-content automod is independent of command defaults."
  );
}
