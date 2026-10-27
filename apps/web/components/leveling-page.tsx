"use client";
import { useState } from "react";
import { toast } from "sonner";
import { Award, Info, Plus, Settings2, Trash2, TrendingUp } from "lucide-react";
import type { GuildConfig } from "@orbit/core";
import { totalXpForLevel, xpForLevel } from "@orbit/core/leveling";
import { renderAnnouncement } from "@orbit/core/leveling-rewards";
import type { XpLeaderRow } from "@orbit/db";
import { cn, number } from "@/lib/utils";
import { DataTable, type DataColumn } from "./data-table";
import { IdentityCell } from "./identity/identity-cell";
import { PageHeader } from "./page-header";
import { Button } from "./ui/button";
import { Combobox } from "./ui/combobox";
import { Switch } from "./ui/switch";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "./ui/dialog";
import {
  Badge,
  Card,
  EmptyState,
  Field,
  Input,
  SectionHeader,
} from "./ui/primitives";
import { TabBar, TabPanel } from "./ui/tabs";
import { useWorkspace } from "./workspace";

type XpRow = XpLeaderRow & {
  username: string | null;
  globalName: string | null;
  nickname: string | null;
  avatarUrl: string | null;
};

export function LevelingPage() {
  const { data, saveConfig } = useWorkspace();
  const [tab, setTab] = useState("board");
  const [settings, setSettings] = useState(false);
  const xp = data.guild.config.xp;
  const enabled = data.guild.config.modules.xp;

  const rows = ((data.xpBoard?.rows ?? []) as XpRow[]).map((row) => ({
    ...row,
    id: row.userId,
  }));

  async function toggle(on: boolean) {
    try {
      await saveConfig({
        ...data.guild.config,
        modules: { ...data.guild.config.modules, xp: on },
      });
      toast.success(
        on ? "Levels are on. Let people grow into it." : "Levels paused."
      );
    } catch (e: any) {
      toast.error(e.message);
    }
  }

  const columns: DataColumn<XpRow & { id: string }>[] = [
    {
      key: "rank",
      label: "#",
      canHide: false,
      align: "right",
      sortValue: (r) => r.rank,
      render: (r) => (
        <span
          className={cn(
            "tabular-nums",
            r.rank === 1 && "font-medium text-primary"
          )}
        >
          {r.rank}
        </span>
      ),
    },
    {
      key: "member",
      label: "Member",
      canHide: false,
      sortValue: (r) => r.nickname ?? r.globalName ?? r.username ?? r.userId,
      render: (r) => (
        <IdentityCell
          id={r.userId}
          name={r.nickname ?? r.globalName ?? r.username ?? r.userId}
          src={r.avatarUrl}
          person={r}
          badge={
            r.userId === data.user.id ? <Badge tone="purple">You</Badge> : null
          }
        />
      ),
    },
    {
      key: "level",
      label: "Level",
      canHide: false,
      sortValue: (r) => r.level,
      render: (r) => <span className="tabular-nums">Level {r.level}</span>,
    },
    {
      key: "progress",
      label: "Progress",
      canHide: true,
      sortValue: (r) => r.into,
      render: (r) => <ProgressInto into={r.into} needed={r.needed} />,
    },
    {
      key: "total",
      label: "Total XP",
      canHide: false,
      align: "right",
      sortValue: (r) => r.total,
      render: (r) => <span className="tabular-nums">{number(r.total)}</span>,
    },
    {
      key: "split",
      label: "Messages / voice / adjusted",
      canHide: true,
      align: "right",
      sortValue: (r) => r.messageXp,
      render: (r) => (
        <span className="tabular-nums text-muted-foreground">
          {number(r.messageXp)} / {number(r.voiceXp)} / {number(r.adjustedXp)}
        </span>
      ),
    },
  ];

  return (
    <>
      <PageHeader
        title="A little give. A little grow."
        description="Levels are a quiet record of who shows up. Nobody is ranked by money here."
        badge={enabled ? undefined : "Paused"}
      >
        <Button variant="outline" onClick={() => setSettings(true)}>
          <Settings2 size={14} />
          Leveling settings
        </Button>
      </PageHeader>

      <TabBar
        id="leveling"
        label="Leveling sections"
        tabs={[
          { id: "board", label: "Leaderboard" },
          { id: "curve", label: "How levels work" },
          { id: "rewards", label: "Role rewards" },
        ]}
        value={tab}
        onChange={setTab}
      />

      <TabPanel id="board" tab={tab}>
        <Card className="mt-4">
          <SectionHeader
            title="Who has been showing up"
            icon={TrendingUp}
            badge={
              data.xpBoard ? (
                <Badge tone="neutral">
                  {number(data.xpBoard.total)} earning
                </Badge>
              ) : null
            }
          />
          <p className="px-6 pt-4 text-[11px] leading-relaxed text-muted-foreground">
            Names come from the server roster, so a member you have never synced
            is shown as an id rather than an invented name.
          </p>
          {!enabled ? (
            <EmptyState
              title="Levels are paused"
              description="Turn the module on to start counting. Nothing is lost while it is off."
            />
          ) : rows.length ? (
            <DataTable
              rows={rows}
              columns={columns}
              pageSize={25}
              label="XP leaderboard"
              emptyTitle="Nobody has earned XP yet"
              emptyDescription="Once someone sends a message or joins a voice channel, they will appear here."
            />
          ) : (
            <EmptyState
              title="Nobody has earned XP yet"
              description="Once someone sends a message or joins a voice channel, they will appear here."
            />
          )}
          {data.xpBoard && data.xpBoard.total > rows.length ? (
            <p className="px-6 pb-5 text-[10px] text-muted-foreground">
              Showing the first {rows.length} of {number(data.xpBoard.total)}.
              The rest are reachable with <code>/levels</code> in Discord.
            </p>
          ) : null}
        </Card>
      </TabPanel>

      <TabPanel id="curve" tab={tab}>
        <CurveCard />
      </TabPanel>

      <TabPanel id="rewards" tab={tab}>
        <RewardsCard onEdit={() => setSettings(true)} rewards={xp.rewards} />
      </TabPanel>

      {settings && (
        <LevelingSettings
          onClose={() => setSettings(false)}
          enabled={enabled}
          onToggle={toggle}
        />
      )}
    </>
  );
}

function ProgressInto({ into, needed }: { into: number; needed: number }) {
  const pct = needed > 0 ? Math.min(100, Math.round((into / needed) * 100)) : 0;
  return (
    <div className="flex items-center gap-2">
      <div
        className="h-1.5 w-20 overflow-hidden rounded-full bg-border/70"
        role="img"
        aria-label={`${pct}% of the way to the next level`}
      >
        <div
          className="h-full rounded-full bg-primary"
          style={{ width: `${pct}%` }}
        />
      </div>
      <span className="tabular-nums text-[10px] text-muted-foreground">
        {number(into)}/{number(needed)}
      </span>
    </div>
  );
}

/**
 * The curve, said out loud.
 *
 * The single most common way to get a leveling system wrong is to conflate
 * "XP to reach this level" with "XP this level costs". Both are printed here,
 * from the live functions, so the page cannot drift from what the bot does.
 */
function CurveCard() {
  const levels = [1, 2, 3, 5, 10, 25, 50, 100];
  return (
    <Card className="mt-4">
      <SectionHeader title="How a level is earned" icon={Info} />
      <p className="px-6 pt-4 text-[11px] leading-relaxed text-muted-foreground">
        Each level costs more than the last, by a fixed rule. Nothing here is
        random or hidden.
      </p>
      <div className="px-6 pb-2">
        <div className="mb-4 flex items-start gap-2.5 rounded-md border border-border/70 bg-muted/30 px-3 py-2.5">
          <Info size={14} className="mt-0.5 shrink-0 text-primary/70" />
          <p className="text-[11px] leading-relaxed text-muted-foreground">
            Level <em>n</em> costs{" "}
            <code className="text-foreground">5n² + 50n + 100</code> XP to
            complete. Reaching level <em>n</em> in total has cost{" "}
            <code className="text-foreground">
              (5/3)n³ + (45/2)n² + (455/6)n
            </code>
            . The two numbers are different and both are shown below — mixing
            them up is the usual mistake.
          </p>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-[11px]">
            <thead>
              <tr className="border-b border-border/70 text-left text-muted-foreground">
                <th className="py-2 pr-4 font-medium">Reaching level</th>
                <th className="py-2 pr-4 text-right font-medium">
                  This level costs
                </th>
                <th className="py-2 text-right font-medium">
                  Total XP to get here
                </th>
              </tr>
            </thead>
            <tbody>
              {levels.map((level) => (
                <tr
                  key={level}
                  className="border-b border-border/40 last:border-0"
                >
                  <td className="py-2 pr-4">Level {level}</td>
                  <td className="py-2 pr-4 text-right tabular-nums">
                    {number(xpForLevel(level))}
                  </td>
                  <td className="py-2 text-right tabular-nums">
                    {number(totalXpForLevel(level))}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </Card>
  );
}

function RewardsCard({
  rewards,
  onEdit,
}: {
  rewards: GuildConfig["xp"]["rewards"];
  onEdit: () => void;
}) {
  const roleName = (id: string) =>
    id.replace(/[^0-9]/g, "").slice(-4) ? `Role ${id.slice(-4)}` : id;
  return (
    <Card className="mt-4">
      <SectionHeader
        title="Roles people grow into"
        icon={Award}
        aside={
          <Button variant="outline" size="sm" onClick={onEdit}>
            <Settings2 size={13} />
            Edit rewards
          </Button>
        }
      />
      <p className="px-6 pt-4 text-[11px] leading-relaxed text-muted-foreground">
        Each entry gives a role when someone reaches that level. Roles are
        granted in Discord itself, so the bot needs Manage Roles and a role
        above the ones it hands out.
      </p>
      {rewards.length ? (
        <ul className="divide-y divide-border/50">
          {[...rewards]
            .sort(
              (
                a: GuildConfig["xp"]["rewards"][number],
                b: GuildConfig["xp"]["rewards"][number]
              ) => a.level - b.level
            )
            .map((reward) => (
              <li
                key={`${reward.level}:${reward.roleId}`}
                className="flex items-center gap-3 px-6 py-3"
              >
                <Award size={14} className="text-primary/70" />
                <span className="text-[12px]">Level {reward.level}</span>
                <span className="text-[11px] text-muted-foreground">→</span>
                <Badge>{roleName(reward.roleId)}</Badge>
                <span className="ml-auto text-[10px] text-muted-foreground">
                  {number(totalXpForLevel(reward.level))} XP in total
                </span>
              </li>
            ))}
        </ul>
      ) : (
        <EmptyState
          title="No reward roles yet"
          description="Levels still count. Rewards just give people something to see for it."
        />
      )}
    </Card>
  );
}

const CHANNELS_OF = (channels: { id: string; name: string }[]) =>
  channels.map((c) => ({ value: c.id, label: c.name }));

function LevelingSettings({
  onClose,
  enabled,
  onToggle,
}: {
  onClose: () => void;
  enabled: boolean;
  onToggle: (on: boolean) => void;
}) {
  const { data, saveConfig } = useWorkspace();
  const [v, setV] = useState(data.guild.config.xp);
  const [busy, setBusy] = useState(false);
  const [tab, setTab] = useState("messages");

  const channels = data.guild.channels ?? [];
  const roles = data.guild.roles ?? [];
  const textish = channels.filter((c) => c.type !== "voice");

  const preview = renderAnnouncement(v.announceMessage, {
    member: "@Ada",
    level: 10,
    role: "Regular",
  });

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Make levels feel like your server</DialogTitle>
          <DialogDescription>
            Bounded everywhere: an unbounded award is a currency bug waiting to
            happen.
          </DialogDescription>
        </DialogHeader>

        <div className="flex items-center justify-between rounded-md border border-border/70 px-3 py-2.5">
          <div>
            <p className="text-[12px] font-medium">Levels & XP</p>
            <p className="text-[10px] text-muted-foreground">
              Pausing keeps every total. Nobody loses what they earned.
            </p>
          </div>
          <Switch
            checked={enabled}
            onCheckedChange={onToggle}
            aria-label="Enable levels and XP"
          />
        </div>

        <TabBar
          id="leveling-settings"
          label="Leveling settings sections"
          tabs={[
            { id: "messages", label: "Messages" },
            { id: "voice", label: "Voice" },
            { id: "exclusions", label: "Exclusions" },
            { id: "rewards", label: "Rewards" },
            { id: "announce", label: "Announcement" },
          ]}
          value={tab}
          onChange={setTab}
        />

        <form
          className="max-h-[50vh] space-y-5 overflow-y-auto pr-1"
          onSubmit={async (e) => {
            e.preventDefault();
            setBusy(true);
            try {
              await saveConfig({ ...data.guild.config, xp: v });
              toast.success("Leveling settings saved");
              onClose();
            } catch (err: any) {
              toast.error(err.message);
            } finally {
              setBusy(false);
            }
          }}
        >
          <TabPanel id="messages" tab={tab}>
            <div className="flex items-center justify-between py-2">
              <span className="text-[12px]">Award XP for messages</span>
              <Switch
                checked={v.messageEnabled}
                onCheckedChange={(b) => setV({ ...v, messageEnabled: b })}
                aria-label="Award XP for messages"
              />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <Field
                label="Minimum per message"
                hint="Applies once the cooldown has passed."
              >
                <Input
                  type="number"
                  min={1}
                  max={500}
                  value={v.messageMin}
                  onChange={(e) =>
                    setV({ ...v, messageMin: Number(e.target.value) })
                  }
                />
              </Field>
              <Field label="Maximum per message">
                <Input
                  type="number"
                  min={1}
                  max={500}
                  value={v.messageMax}
                  onChange={(e) =>
                    setV({ ...v, messageMax: Number(e.target.value) })
                  }
                />
              </Field>
            </div>
            <Field
              label="Seconds between awards"
              hint="One award per member per window, however much they post."
            >
              <Input
                type="number"
                min={5}
                max={3600}
                value={v.messageCooldownSeconds}
                onChange={(e) =>
                  setV({
                    ...v,
                    messageCooldownSeconds: Number(e.target.value),
                  })
                }
              />
            </Field>
            <p className="text-[10px] leading-relaxed text-muted-foreground">
              Bots and webhooks never earn, and neither does a repeated message.
              Only a short fingerprint of the text is kept, never the message
              itself. Editing a message does not award again, and deleting one
              does not take XP back.
            </p>
          </TabPanel>

          <TabPanel id="voice" tab={tab}>
            <div className="flex items-center justify-between py-2">
              <span className="text-[12px]">Award XP for voice</span>
              <Switch
                checked={v.voiceEnabled}
                onCheckedChange={(b) => setV({ ...v, voiceEnabled: b })}
                aria-label="Award XP for voice"
              />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <Field label="Minimum per interval">
                <Input
                  type="number"
                  min={1}
                  max={500}
                  value={v.voiceMin}
                  onChange={(e) =>
                    setV({ ...v, voiceMin: Number(e.target.value) })
                  }
                />
              </Field>
              <Field label="Maximum per interval">
                <Input
                  type="number"
                  min={1}
                  max={500}
                  value={v.voiceMax}
                  onChange={(e) =>
                    setV({ ...v, voiceMax: Number(e.target.value) })
                  }
                />
              </Field>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <Field label="Interval (seconds)">
                <Input
                  type="number"
                  min={30}
                  max={3600}
                  value={v.voiceIntervalSeconds}
                  onChange={(e) =>
                    setV({ ...v, voiceIntervalSeconds: Number(e.target.value) })
                  }
                />
              </Field>
              <Field label="Session cap (minutes)" hint="0 means no cap.">
                <Input
                  type="number"
                  min={0}
                  max={1440}
                  value={v.voiceSessionCapMinutes}
                  onChange={(e) =>
                    setV({
                      ...v,
                      voiceSessionCapMinutes: Number(e.target.value),
                    })
                  }
                />
              </Field>
            </div>
            <Field
              label="People required in the channel"
              hint="Bots never count. Sitting alone earns nothing."
            >
              <Input
                type="number"
                min={1}
                max={50}
                value={v.voiceMinParticipants}
                onChange={(e) =>
                  setV({ ...v, voiceMinParticipants: Number(e.target.value) })
                }
              />
            </Field>
            <div className="space-y-2 pt-1">
              <p className="text-[11px] font-medium">Who still earns</p>
              {(
                [
                  ["voiceAllowSelfMute", "Self-muted members"],
                  ["voiceAllowSelfDeaf", "Self-deafened members"],
                  ["voiceAllowServerMute", "Server-muted members"],
                  ["voiceAllowServerDeaf", "Server-deafened members"],
                ] as const
              ).map(([key, label]) => (
                <div
                  className="flex items-center justify-between py-1.5"
                  key={key}
                >
                  <span className="text-[11px] text-muted-foreground">
                    {label}
                  </span>
                  <Switch
                    checked={v[key]}
                    onCheckedChange={(b) => setV({ ...v, [key]: b })}
                    aria-label={label}
                  />
                </div>
              ))}
            </div>
            <p className="text-[10px] leading-relaxed text-muted-foreground">
              AFK never earns. A member has to be present and eligible for the
              whole interval — moving channels mid-interval just starts the next
              one. After a restart nobody is paid for time the bot could not
              see.
            </p>
          </TabPanel>

          <TabPanel id="exclusions" tab={tab}>
            <Field
              label="Channels that never earn"
              hint="Announcements or anything you would rather keep quiet."
            >
              <Combobox
                value=""
                onValueChange={(id) =>
                  id &&
                  !v.excludedChannelIds.includes(id) &&
                  setV({
                    ...v,
                    excludedChannelIds: [...v.excludedChannelIds, id],
                  })
                }
                options={CHANNELS_OF(textish).filter(
                  (c) => !v.excludedChannelIds.includes(c.value)
                )}
                placeholder="Add a channel…"
                emptyText="Every channel is already listed."
                aria-label="Excluded channels"
              />
            </Field>
            <Chips
              ids={v.excludedChannelIds}
              labelOf={(id) => channels.find((c) => c.id === id)?.name ?? id}
              onRemove={(id) =>
                setV({
                  ...v,
                  excludedChannelIds: v.excludedChannelIds.filter(
                    (x) => x !== id
                  ),
                })
              }
            />
            <Field
              label="Roles that never earn"
              hint="Useful for quiet roles, or for keeping bots out."
            >
              <Combobox
                value=""
                onValueChange={(id) =>
                  id &&
                  !v.excludedRoleIds.includes(id) &&
                  setV({ ...v, excludedRoleIds: [...v.excludedRoleIds, id] })
                }
                options={roles
                  .filter((r) => !v.excludedRoleIds.includes(r.id))
                  .map((r) => ({ value: r.id, label: r.name }))}
                placeholder="Add a role…"
                emptyText="Every role is already listed."
                aria-label="Excluded roles"
              />
            </Field>
            <Chips
              ids={v.excludedRoleIds}
              labelOf={(id) => roles.find((r) => r.id === id)?.name ?? id}
              onRemove={(id) =>
                setV({
                  ...v,
                  excludedRoleIds: v.excludedRoleIds.filter((x) => x !== id),
                })
              }
            />
            <div className="space-y-2 pt-1">
              {(
                [
                  ["ignoreBots", "Bots never earn XP"],
                  ["ignoreWebhooks", "Webhooks never earn XP"],
                ] as const
              ).map(([key, label]) => (
                <div
                  className="flex items-center justify-between py-1.5"
                  key={key}
                >
                  <span className="text-[11px] text-muted-foreground">
                    {label}
                  </span>
                  <Switch
                    checked={v[key]}
                    onCheckedChange={(b) => setV({ ...v, [key]: b })}
                    aria-label={label}
                  />
                </div>
              ))}
            </div>
          </TabPanel>

          <TabPanel id="rewards" tab={tab}>
            <div className="flex items-center justify-between py-2">
              <div>
                <p className="text-[12px]">Keep every reward earned</p>
                <p className="text-[10px] text-muted-foreground">
                  Off means only the highest reward reached is kept; the earlier
                  roles are given back.
                </p>
              </div>
              <Switch
                checked={v.rewardStack}
                onCheckedChange={(b) => setV({ ...v, rewardStack: b })}
                aria-label="Keep every reward earned"
              />
            </div>
            <div className="space-y-3 pt-1">
              {v.rewards
                .slice()
                .sort(
                  (
                    a: { level: number; roleId: string },
                    b: { level: number; roleId: string }
                  ) => a.level - b.level
                )
                .map((reward, index) => (
                  <div className="flex items-end gap-2" key={index}>
                    <Field label="Level">
                      <Input
                        type="number"
                        min={1}
                        max={1000}
                        value={reward.level}
                        onChange={(e) =>
                          setV({
                            ...v,
                            rewards: v.rewards.map((r, i) =>
                              i === index
                                ? { ...r, level: Number(e.target.value) }
                                : r
                            ),
                          })
                        }
                      />
                    </Field>
                    <Field label="Role">
                      <Combobox
                        value={reward.roleId}
                        onValueChange={(id) =>
                          setV({
                            ...v,
                            rewards: v.rewards.map((r, i) =>
                              i === index ? { ...r, roleId: id } : r
                            ),
                          })
                        }
                        options={roles.map((r) => ({
                          value: r.id,
                          label: r.name,
                        }))}
                        placeholder="Pick a role…"
                        aria-label="Reward role"
                      />
                    </Field>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      aria-label={`Remove the level ${reward.level} reward`}
                      onClick={() =>
                        setV({
                          ...v,
                          rewards: v.rewards.filter((_, i) => i !== index),
                        })
                      }
                    >
                      <Trash2 size={14} />
                    </Button>
                  </div>
                ))}
              {v.rewards.length < 100 && (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() =>
                    setV({
                      ...v,
                      rewards: [...v.rewards, { level: 5, roleId: "" }],
                    })
                  }
                >
                  <Plus size={13} />
                  Add a reward
                </Button>
              )}
            </div>
            <p className="pt-2 text-[10px] leading-relaxed text-muted-foreground">
              A reward is granted after every XP change, including an
              operator&apos;s adjustment, and is recorded before it is announced
              — so a retry never announces twice and a failed announcement never
              costs anyone their XP. A role granting Administrator is refused
              outright: reaching a level must never be a route to it.
            </p>
          </TabPanel>

          <TabPanel id="announce" tab={tab}>
            <div className="flex items-center justify-between py-2">
              <span className="text-[12px]">Announce level ups</span>
              <Switch
                checked={v.announceEnabled}
                onCheckedChange={(b) => setV({ ...v, announceEnabled: b })}
                aria-label="Announce level ups"
              />
            </div>
            <Field label="Where to post it">
              <Combobox
                value={v.announceChannelId}
                onValueChange={(id) => setV({ ...v, announceChannelId: id })}
                options={textish.map((c) => ({
                  value: c.id,
                  label: c.name,
                }))}
                placeholder="Pick a channel…"
                aria-label="Announcement channel"
              />
            </Field>
            <Field
              label="Message"
              hint="Use {member}, {level} and {role}. Nothing else is interpreted."
            >
              <Input
                value={v.announceMessage}
                maxLength={500}
                onChange={(e) =>
                  setV({ ...v, announceMessage: e.target.value })
                }
              />
            </Field>
            <div className="rounded-md border border-border/70 bg-muted/30 px-3 py-2.5">
              <p className="mb-1 text-[10px] uppercase tracking-wide text-muted-foreground">
                Preview
              </p>
              <p className="text-[12px]">{preview || "—"}</p>
            </div>
          </TabPanel>

          <div className="flex justify-end gap-2 pt-2">
            <Button type="button" variant="ghost" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" disabled={busy}>
              {busy ? "Saving…" : "Save settings"}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function Chips({
  ids,
  labelOf,
  onRemove,
}: {
  ids: string[];
  labelOf: (id: string) => string;
  onRemove: (id: string) => void;
}) {
  if (!ids.length) return null;
  return (
    <div className="flex flex-wrap gap-1.5 pb-2">
      {ids.map((id) => (
        <button
          type="button"
          key={id}
          onClick={() => onRemove(id)}
          className="inline-flex items-center gap-1 rounded-full border border-border/70 px-2 py-0.5 text-[10px] hover:border-destructive/50"
          aria-label={`Remove ${labelOf(id)}`}
        >
          {labelOf(id)}
          <Trash2 size={9} />
        </button>
      ))}
    </div>
  );
}
