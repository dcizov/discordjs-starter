"use client";
import {
  membersQueryString,
  type MemberFilter,
} from "@orbit/core/members-query";
import type { GuildRole, Member, MembersPage, RosterSync } from "@orbit/core";
import {
  AlertTriangle,
  CircleCheck,
  RefreshCw,
  Users,
  UserCog,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { DataTable, type Column } from "./data-table";
import { PageHeader } from "./page-header";
import type { FacetFilter } from "./table-facet";
import { useWorkspace } from "./workspace";
import { IdentityCell } from "./identity/identity-cell";
import { RoleList } from "./role-badge";
import { Button } from "./ui/button";
import {
  Badge,
  Card,
  ErrorState,
  SectionHeader,
  Skeleton,
} from "./ui/primitives";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "./ui/dialog";
import { relativeTime } from "@/lib/utils";

/**
 * The real member directory.
 *
 * Everything on this page comes from the roster the bot synchronized through the
 * Guild Members gateway intent. It is deliberately not assembled from economy
 * accounts, audit actors or song requesters: those are subsets of people who
 * interacted with Orbit, and calling such a list "the members" would be wrong.
 *
 * The sync banner is part of the page, not decoration. A reader must be able to
 * tell whether the list in front of them is the whole guild, a partial sweep, or
 * a failure that left the previous rows in place.
 */
type MemberRow = Member & { id: string };

export function MembersPage() {
  const { api, data } = useWorkspace();
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<MemberFilter>("all");
  const [sort, setSort] = useState<{
    field: "displayName" | "joinedAt" | "username";
    dir: "asc" | "desc";
  }>({ field: "displayName", dir: "asc" });
  const [result, setResult] = useState<MembersPage | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [retry, setRetry] = useState(0);
  const [syncing, setSyncing] = useState(false);
  const [syncNote, setSyncNote] = useState("");
  const [detail, setDetail] = useState<Member | null>(null);

  // A new search, filter or ordering means page 1 of the new result set.
  useEffect(() => setPage(1), [query, filter, pageSize]);

  useEffect(() => {
    let active = true;
    setLoading(true);
    api<MembersPage>(
      `/members?${membersQueryString({
        page,
        pageSize,
        query,
        filter,
        sort: sort.field,
        dir: sort.dir,
      })}`
    )
      .then((next) => {
        if (!active) return;
        setResult(next);
        setError("");
      })
      .catch((e) => {
        if (active) setError(e.message);
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [api, page, pageSize, query, filter, sort, retry]);

  const sync = result?.sync ?? null;
  const counts = result?.counts;
  const retryRequest = () => setRetry((v) => v + 1);

  const requestSync = useCallback(async () => {
    setSyncing(true);
    setSyncNote("");
    try {
      const response = await api<{ demo?: boolean; message?: string }>(
        "/members/sync",
        "POST"
      );
      setSyncNote(
        response.message ??
          "A sweep was queued. The counts here update when the bot reports back."
      );
      // Refresh the visible page so the banner reflects the new attempt state.
      retryRequest();
    } catch (e) {
      setSyncNote(
        e instanceof Error ? e.message : "The sweep could not start."
      );
    } finally {
      setSyncing(false);
    }
  }, [api]);

  // TanStack keys rows by their own id; a member's identity in this guild is
  // (guild, user), which is exactly what the roster table stores.
  const rows = useMemo<MemberRow[]>(
    () => (result?.rows ?? []).map((m) => ({ ...m, id: m.userId })),
    [result]
  );

  // Whole role objects, not just names: the shared role component needs the
  // colour, the position for hierarchy ordering, and the managed flag.
  const roles = useMemo(
    () => new Map(data.guild.roles.map((role) => [role.id, role])),
    [data.guild.roles]
  );
  /** Resolve a member's role ids to roles that still exist in this guild. */
  const rolesOf = useCallback(
    (ids: readonly string[]) =>
      ids
        .map((id) => roles.get(id))
        .filter((role): role is GuildRole => !!role),
    [roles]
  );

  const columns: Column<MemberRow>[] = [
    {
      key: "member",
      label: "Member",
      canHide: false,
      render: (m) => (
        <span className="flex min-w-0 items-center gap-2.5">
          <IdentityCell
            id={m.userId}
            name={m.displayName}
            // The guild avatar again: this is the picture Discord shows in this
            // server, not the account's global one.
            src={m.avatarUrl}
            person={m}
          />
          {m.bot && (
            <Badge tone="blue" className="shrink-0 text-[9px]">
              Bot
            </Badge>
          )}
          {!m.present && (
            <Badge tone="neutral" className="shrink-0 text-[9px]">
              Left
            </Badge>
          )}
        </span>
      ),
    },
    {
      key: "joined",
      label: "Joined",
      render: (m) =>
        m.joinedAt ? (
          <span className="whitespace-nowrap text-muted-foreground">
            {new Date(m.joinedAt).toLocaleDateString("en", {
              timeZone: data.guild.config.timezone,
              year: "numeric",
              month: "short",
              day: "numeric",
            })}
          </span>
        ) : (
          <span className="text-muted-foreground">Not shared by Discord</span>
        ),
    },
    {
      key: "roles",
      label: "Roles",
      render: (m) => <RoleList roles={rolesOf(m.roles)} max={2} />,
    },
  ];

  const filters: FacetFilter[] = [
    {
      key: "members-filter",
      label: "Filter members",
      title: "Members",
      value: filter,
      allValue: "all",
      onChange: (value) => setFilter(value as MemberFilter),
      // Counts are the synced rows, so they are exact for the roster on screen —
      // and the banner above says whether that roster is complete.
      options: [
        { value: "all", label: "Everyone" },
        {
          value: "humans",
          label: "People",
          count: counts
            ? Math.max(0, counts.syncedMembers - counts.bots)
            : undefined,
        },
        { value: "bots", label: "Bots", count: counts?.bots },
        {
          value: "departed",
          label: "Left the server",
          count: counts?.departed,
        },
      ],
      searchable: false,
    },
  ];

  return (
    <>
      <PageHeader
        title="The people who make this place."
        description="Every member Discord reports in this server, kept current by Orbit’s roster sync."
        badge="Live roster"
      >
        <Button
          variant="outline"
          size="sm"
          disabled={syncing || !data.guild.installed}
          onClick={() => void requestSync()}
        >
          <RefreshCw
            size={12}
            aria-hidden
            className={syncing ? "animate-spin" : undefined}
          />
          {syncing ? "Asking the bot…" : "Sync now"}
        </Button>
      </PageHeader>
      <SyncBanner
        sync={sync}
        counts={counts}
        demo={data.demo}
        note={syncNote}
        referenceAt={data.presentation.referenceAt}
      />
      <Card>
        <SectionHeader
          icon={Users}
          title="Member directory"
          badge={
            counts ? (
              <span className="text-[10px] font-normal text-muted-foreground">
                {counts.syncedMembers.toLocaleString("en-US")} synchronized
              </span>
            ) : null
          }
        />
        {error && !result ? (
          <ErrorState
            title="The member directory couldn’t load."
            detail={error}
            onRetry={retryRequest}
          />
        ) : !result ? (
          <div className="space-y-4 p-5" aria-label="Loading members">
            {[1, 2, 3, 4, 5, 6].map((n) => (
              <Skeleton key={n} className="h-10 w-full" />
            ))}
          </div>
        ) : (
          <DataTable<MemberRow>
            label="Member directory"
            rows={rows}
            columns={columns}
            loading={loading}
            error={error}
            onRetry={retryRequest}
            pageSize={pageSize}
            pagination={{
              page,
              total: result.total,
              onPage: setPage,
              onPageSize: setPageSize,
            }}
            sort={{
              field: sort.field,
              dir: sort.dir,
              onChange: (field) =>
                setSort((current) =>
                  current.field === field
                    ? {
                        field: field as typeof sort.field,
                        dir: current.dir === "asc" ? "desc" : "asc",
                      }
                    : { field: field as typeof sort.field, dir: "asc" }
                ),
            }}
            search={{
              value: query,
              onChange: setQuery,
              placeholder: "Name, nickname, or @handle…",
              label: "Search the member directory",
            }}
            filters={filters}
            rowActions={{
              label: (m) => `Actions for ${m.displayName}`,
              items: (m) => [
                {
                  label: "View member details",
                  icon: <UserCog size={13} aria-hidden />,
                  onSelect: () => setDetail(m),
                },
              ],
            }}
            footerNote={
              sync?.status === "complete"
                ? undefined
                : "· from a roster that is not complete yet"
            }
            emptyTitle={
              query || filter !== "all"
                ? "No member matches"
                : sync?.status === "never"
                  ? "The roster hasn’t been synchronized yet"
                  : "This roster is empty"
            }
            emptyDescription={
              query || filter !== "all"
                ? "Try part of a display name, a nickname, or a handle — search and filters stay available."
                : sync?.status === "never"
                  ? "Orbit has not finished its first member sweep for this server. Run a sync above, or wait for the next scheduled one."
                  : "No member rows were synchronized. Run a sync to ask Discord again."
            }
          />
        )}
      </Card>
      <p className="mt-4 text-[11px] leading-relaxed text-muted-foreground">
        Only people Discord reports for this server appear here. Economy
        balances, audit history and music requests are separate records and
        never stand in for the roster.
      </p>
      <MemberDetail
        member={detail}
        roles={roles}
        timezone={data.guild.config.timezone}
        onClose={() => setDetail(null)}
      />
    </>
  );
}

/** The honest state of the copy on screen. */
function SyncBanner({
  sync,
  counts,
  demo,
  note,
  referenceAt,
}: {
  sync: RosterSync | null;
  counts: MembersPage["counts"] | undefined;
  demo: boolean;
  note: string;
  referenceAt: string;
}) {
  if (!sync || !counts) return null;
  const guildCount = counts.guildMemberCount;
  const synced = counts.syncedMembers;
  // Discord's own number and Orbit's row count are reported side by side and
  // never merged: only an equal pair with a completed sweep reads as complete.
  const complete =
    sync.status === "complete" && (guildCount === 0 || synced >= guildCount);
  const headline = (() => {
    if (sync.status === "never")
      return "No member sweep has run for this server yet.";
    if (sync.status === "running")
      return "A member sweep is running right now.";
    if (sync.status === "failed")
      return "The last member sweep failed. The rows below are from the previous successful sweep.";
    if (sync.status === "partial")
      return "The last member sweep stopped before it reached everyone.";
    return complete
      ? "Every member Discord reports is synchronized."
      : "The last member sweep completed but Discord reports more members than Orbit holds.";
  })();
  const tone =
    sync.status === "complete" && complete
      ? "ok"
      : sync.status === "failed"
        ? "bad"
        : "warn";
  return (
    <div
      className="mb-5 rounded-xl border bg-card/60 px-4 py-3.5"
      data-testid="roster-sync-banner"
    >
      <div className="flex flex-wrap items-start gap-2.5">
        {tone === "ok" ? (
          <CircleCheck
            size={15}
            className="mt-0.5 shrink-0 text-emerald-600"
            aria-hidden
          />
        ) : (
          <AlertTriangle
            size={15}
            className={
              tone === "bad"
                ? "mt-0.5 shrink-0 text-red-600"
                : "mt-0.5 shrink-0 text-amber-500"
            }
            aria-hidden
          />
        )}
        <div className="min-w-0 flex-1">
          <p className="text-xs font-medium">{headline}</p>
          <p className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] text-muted-foreground">
            <span>
              <span className="tabular-nums text-foreground">
                {synced.toLocaleString("en-US")}
              </span>{" "}
              synchronized
            </span>
            <span aria-hidden>·</span>
            <span>
              Discord reports{" "}
              <span className="tabular-nums text-foreground">
                {guildCount.toLocaleString("en-US")}
              </span>
            </span>
            {sync.pagesFetched ? (
              <>
                <span aria-hidden>·</span>
                <span>
                  {sync.pagesFetched} page{sync.pagesFetched === 1 ? "" : "s"}{" "}
                  fetched
                </span>
              </>
            ) : null}
            {sync.completedAt ? (
              <>
                <span aria-hidden>·</span>
                <span>
                  Last completed {relativeTime(sync.completedAt, referenceAt)}
                </span>
              </>
            ) : sync.lastAttemptAt ? (
              <>
                <span aria-hidden>·</span>
                <span>
                  Last attempt {relativeTime(sync.lastAttemptAt, referenceAt)}
                </span>
              </>
            ) : null}
          </p>
          {sync.lastError && (
            <p className="mt-1.5 text-[11px] leading-relaxed text-red-700 dark:text-red-400">
              {sync.lastError}
            </p>
          )}
          {note && (
            <p className="mt-1.5 text-[11px] leading-relaxed text-muted-foreground">
              {note}
            </p>
          )}
          {demo && (
            <p className="mt-1.5 text-[11px] leading-relaxed text-muted-foreground">
              Demo mode: the roster comes from a sample snapshot, and a sync
              request asks no one.
            </p>
          )}
        </div>
      </div>
    </div>
  );
}

function MemberDetail({
  member,
  roles,
  timezone,
  onClose,
}: {
  member: Member | null;
  roles: Map<string, GuildRole>;
  timezone: string;
  onClose: () => void;
}) {
  /** Ids held by this member, resolved to roles that still exist. */
  const held = (member?.roles ?? [])
    .map((id) => roles.get(id))
    .filter((role): role is GuildRole => !!role);
  return (
    <Dialog
      open={!!member}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Member details</DialogTitle>
          <DialogDescription>
            What Orbit’s roster sync last recorded for this member.
          </DialogDescription>
        </DialogHeader>
        {member && (
          <div className="space-y-4">
            <IdentityCell
              id={member.userId}
              name={member.displayName}
              src={member.avatarUrl}
              person={member}
              size={33}
              badge={
                member.bot ? (
                  <Badge tone="blue" className="text-[9px]">
                    Bot
                  </Badge>
                ) : null
              }
              detail={member.username ? `@${member.username}` : undefined}
            />
            {member.nickname && member.username && (
              <p className="text-[11px] text-muted-foreground">
                Nickname in this server
              </p>
            )}
            <dl className="grid grid-cols-[110px_1fr] gap-x-4 gap-y-2 text-xs">
              <dt className="text-muted-foreground">Discord ID</dt>
              <dd className="font-mono text-[11px]">{member.userId}</dd>
              <dt className="text-muted-foreground">Joined this server</dt>
              <dd>
                {member.joinedAt
                  ? new Date(member.joinedAt).toLocaleString("en", {
                      timeZone: timezone,
                    })
                  : "Not shared by Discord"}
              </dd>
              <dt className="text-muted-foreground">Status</dt>
              <dd>
                {member.present
                  ? "In this server"
                  : `Left${member.departedAt ? ` on ${new Date(member.departedAt).toLocaleDateString("en", { timeZone: timezone })}` : ""}`}
              </dd>
              <dt className="text-muted-foreground">Roles</dt>
              <dd>
                <RoleList roles={held} max={8} />
              </dd>
              <dt className="text-muted-foreground">Identity captured</dt>
              <dd>
                {new Date(member.syncedAt).toLocaleString("en", {
                  timeZone: timezone,
                })}
              </dd>
            </dl>
            <p className="text-[11px] leading-relaxed text-muted-foreground">
              Names, avatars and roles are the last values Discord reported for
              this member. Orbit does not store message content, presence, or
              anything else from this member’s account.
            </p>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
