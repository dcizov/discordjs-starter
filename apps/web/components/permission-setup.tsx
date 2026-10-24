"use client";
import { relativeTime } from "@/lib/utils";
import {
  botGuildPermissions,
  gatewayIntentNames,
  permissionMatrix,
  permissionState,
  roleAssignmentIssue,
  type PermissionName,
} from "@orbit/core/permissions";
import { useState } from "react";
import { Badge, Card, Field, Select } from "./ui/primitives";
import { useWorkspace } from "./workspace";
const label = (name: PermissionName) =>
  name.replace(/([a-z])([A-Z])/g, "$1 $2");
export function PermissionSetup() {
  const { data } = useWorkspace();
  const [channelId, setChannelId] = useState(
    data.guild.channels.find((channel) => channel.type === "text")?.id ??
      data.guild.channels[0]?.id ??
      ""
  );
  const channel = data.guild.channels.find((item) => item.id === channelId);
  const guildBits = botGuildPermissions(data.guild.roles);
  const snapshot = channel?.permissionsSyncedAt;
  const protectedRoles = data.guild.roles.filter((role) =>
    roleAssignmentIssue(role, data.guild.botRolePosition, data.guild.id)
  );
  return (
    <div className="space-y-5" data-testid="permission-setup">
      <Card className="p-5">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="max-w-2xl">
            <h2 className="text-sm font-semibold">Permission & setup checks</h2>
            <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
              {data.demo
                ? "Sample server permissions — no live Discord audit."
                : "Read-only bot sync, not a live audit. Effective channel permissions include category/channel overwrites at the recorded sync; changes in Discord may take up to five minutes to appear."}{" "}
              No grants or channel overwrites are changed here.
            </p>
            <p className="mt-2 text-[11px] text-muted-foreground">
              {snapshot
                ? `Channel snapshot: ${relativeTime(snapshot, data.presentation.referenceAt)} · ${snapshot}`
                : data.demo
                  ? "This older sample has no permission snapshot; no live bot or credentials are needed for demo."
                  : "No permission snapshot yet. Start the installed bot and wait for guild sync; legacy canSend flags are not treated as proof."}
            </p>
          </div>
          <Badge tone={data.demo ? "blue" : snapshot ? "neutral" : "amber"}>
            {data.demo
              ? "Sample data"
              : snapshot
                ? "Synced, not live"
                : "Not verified"}
          </Badge>
        </div>
        <div className="mt-5 max-w-md">
          <Field label="Check a synced channel">
            <Select
              aria-label="Permission check channel"
              value={channelId}
              onChange={(event) => setChannelId(event.target.value)}
            >
              {!data.guild.channels.length && (
                <option value="">No synced channels</option>
              )}
              {data.guild.channels.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.type === "voice"
                    ? "Voice: "
                    : item.type === "stage"
                      ? "Stage (unsupported): "
                      : "#"}
                  {item.name}
                </option>
              ))}
            </Select>
          </Field>
        </div>
        <div className="mt-5 overflow-x-auto">
          <table className="w-full min-w-[650px] text-left text-[11px]">
            <caption className="sr-only">
              Code-derived feature permissions, evaluated against the selected
              channel and synced bot roles
            </caption>
            <thead>
              <tr className="border-b text-muted-foreground">
                <th className="pb-3 pr-4" scope="col">
                  Feature / scope
                </th>
                <th className="pb-3 pr-4" scope="col">
                  Synced check
                </th>
                <th className="pb-3" scope="col">
                  When needed / remediation
                </th>
              </tr>
            </thead>
            <tbody>
              {permissionMatrix.map((feature) => {
                const applicable =
                  feature.scope === "guild" ||
                  feature.channelType === channel?.type;
                const state = permissionState(
                  feature.scope === "guild"
                    ? guildBits
                    : channel?.permissionBits,
                  feature.required
                );
                const text = !applicable
                  ? feature.key === "voice" && channel?.type === "stage"
                    ? "Stage unsupported"
                    : `Choose ${feature.channelType} channel`
                  : state === "present"
                    ? "Bits present"
                    : state === "missing"
                      ? "Missing bits"
                      : "Not verified";
                return (
                  <tr
                    key={feature.key}
                    className="border-b align-top last:border-0"
                  >
                    <th className="py-4 pr-4 font-medium" scope="row">
                      {feature.title}
                      <span className="mt-1 block text-[10px] font-normal text-muted-foreground">
                        {feature.scope === "guild"
                          ? "Bot guild roles"
                          : "Selected channel"}
                        {feature.module &&
                        !data.guild.config.modules[feature.module]
                          ? " · module paused / conditional"
                          : " · only if feature used"}
                      </span>
                    </th>
                    <td className="py-4 pr-4">
                      <Badge
                        tone={
                          !applicable || state === "unknown"
                            ? "neutral"
                            : state === "present"
                              ? "green"
                              : "amber"
                        }
                      >
                        {text}
                      </Badge>
                      <ul className="mt-2 space-y-1 text-[10px] text-muted-foreground">
                        {feature.required.map((name) => (
                          <li key={name}>
                            {label(name)}
                            {applicable &&
                            permissionState(
                              feature.scope === "guild"
                                ? guildBits
                                : channel?.permissionBits,
                              [name]
                            ) === "missing"
                              ? " — missing"
                              : ""}
                          </li>
                        ))}
                      </ul>
                    </td>
                    <td className="py-4 leading-relaxed">
                      <p>{feature.condition}</p>
                      <p className="mt-2 text-muted-foreground">
                        {feature.failure}
                      </p>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Card>
      <div className="grid gap-5 lg:grid-cols-2">
        <Card className="p-5">
          <h3 className="text-sm font-semibold">Keep hierarchy protections</h3>
          <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
            Orbit’s synced highest role position is {data.guild.botRolePosition}
            . Move it above only the safe community/shop roles it manages. Never
            expose @everyone, integration-managed, equal/higher or elevated
            roles. Administrator does not bypass these restrictions or protected
            moderation targets.
          </p>
          <details className="mt-4 text-[11px]">
            <summary className="cursor-pointer font-medium">
              {protectedRoles.length} protected roles and reasons
            </summary>
            <ul className="mt-3 space-y-2 text-muted-foreground">
              {protectedRoles.map((role) => (
                <li key={role.id}>
                  <span className="font-medium text-foreground">
                    {role.name}
                  </span>{" "}
                  —{" "}
                  {roleAssignmentIssue(
                    role,
                    data.guild.botRolePosition,
                    data.guild.id
                  )}
                </li>
              ))}
            </ul>
          </details>
        </Card>
        <Card className="p-5">
          <h3 className="text-sm font-semibold">
            Six separate authorization layers
          </h3>
          <ol className="mt-3 list-decimal space-y-2 pl-4 text-[11px] leading-relaxed text-muted-foreground">
            <li>
              Install scopes: bot + applications.commands. The invite requests
              basic View Channel, Send Messages and Embed Links only; opt into
              feature grants in Discord.
            </li>
            <li>
              Bot guild permissions and selected-channel/category overwrites are
              different; fix the specific denied destination, not the whole
              server.
            </li>
            <li>
              Gateway intents requested in code: {gatewayIntentNames.join(", ")}
              . No Presence intent is requested.
            </li>
            <li>
              Portal privileged intents: enable Server Members and Message
              Content for this runtime. GuildVoiceStates is NOT a privileged
              toggle.
            </li>
            <li>
              Command defaults, runtime moderator checks, protected targets and
              music’s same-channel/DJ rules still apply.
            </li>
            <li>
              Dashboard OAuth uses identify + guilds. Owner/Manage Server (or
              Administrator) authorizes the dashboard, not bot powers; writes
              re-check authorization.
            </li>
          </ol>
          <p className="mt-4 text-[11px] leading-relaxed text-muted-foreground">
            For music, test a normal non-full voice channel with View Channel,
            Connect and Speak. Then distinguish Discord handshake, Lavalink
            player and permitted source loading. No playback claim follows from
            these synced bits.
          </p>
        </Card>
      </div>
    </div>
  );
}
