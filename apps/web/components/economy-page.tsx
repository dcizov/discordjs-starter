"use client";
import { ModuleSetupBanner } from "./module-setup";
import { cn, number, relativeTime } from "@/lib/utils";
import type { Resource, LedgerEntry } from "@orbit/core";
import {
  Check,
  Coins,
  Gift,
  Medal,
  MoreHorizontal,
  Pencil,
  Plus,
  RefreshCw,
  Send,
  Settings2,
  ShieldCheck,
  ShoppingBag,
  Sparkles,
  Trash2,
  Trophy,
  Wallet,
} from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { DataTable } from "./data-table";
import { HistoryTable } from "./history-table";
import { PageHeader } from "./page-header";
import { ResourceEditor } from "./resource-editor";
import { Button } from "./ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "./ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "./ui/dropdown-menu";
import {
  Badge,
  Card,
  EmptyState,
  Field,
  Input,
  SearchInput,
  Select,
  Spinner,
} from "./ui/primitives";
import { Switch } from "./ui/switch";
import { useWorkspace } from "./workspace";
export function EconomyPage() {
  const { data, api, refresh } = useWorkspace();
  const [tab, setTab] = useState("overview");
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState("all");
  const [editor, setEditor] = useState<Resource | null | undefined>(undefined);
  const [deleting, setDeleting] = useState<Resource | null>(null);
  const [purchase, setPurchase] = useState<Resource | null>(null);
  const [transfer, setTransfer] = useState(false);
  const [settings, setSettings] = useState(false);
  const [busy, setBusy] = useState(false);
  const [key, setKey] = useState("");
  const ec = data.guild.config.economy;
  const me =
    data.wallet ?? data.accounts.find((a) => a.userId === data.user.id);
  const shop = data.resources.filter(
    (r) =>
      r.kind === "shop" && r.name.toLowerCase().includes(query.toLowerCase())
  );
  const total =
    data.stats?.circulation ?? data.accounts.reduce((n, a) => n + a.balance, 0);
  const dailyReady =
    !me?.lastDaily ||
    Date.parse(data.presentation.referenceAt) -
      new Date(me.lastDaily).getTime() >=
      86400000;
  async function claimDaily() {
    setBusy(true);
    try {
      const r = await api(
        "/economy/daily",
        "POST",
        {},
        { "idempotency-key": crypto.randomUUID() }
      );
      await refresh();
      toast.success(
        `A little stardust for your day. +${number(r.amount)} ${ec.currency}!`
      );
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <PageHeader
        title="A little give. A little grow."
        description="Reward the people who make your community feel like a community."
      >
        <Button variant="outline" onClick={() => setSettings(true)}>
          <Settings2 size={14} />
          Economy settings
        </Button>
        <Button onClick={() => setEditor(null)}>
          <Plus size={15} />
          Add shop item
        </Button>
      </PageHeader>
      <ModuleSetupBanner module={"economy"} />
      {!data.guild.config.modules.economy && (
        <p className="mb-5 rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs text-amber-700">
          The economy is paused. Enable it in Server settings to allow rewards
          and purchases.
        </p>
      )}
      <div className="mb-6 grid gap-4 sm:grid-cols-3">
        {[
          {
            label: `${ec.currency} in circulation`,
            value: number(total),
            detail: "Every little contribution adds up.",
            icon: Coins,
            bg: "bg-[#fbf4e4] text-[#caa557]",
          },
          {
            label: "Community earners",
            value: number(data.stats?.accountCount ?? data.accounts.length),
            detail: "Making this corner a little brighter.",
            icon: Wallet,
            bg: "bg-violet-50 text-violet-400",
          },
          {
            label: "Daily reward",
            value: `${number(ec.dailyAmount)} ${ec.symbol}`,
            detail: "A reason to drop in and say hello.",
            icon: Gift,
            bg: "bg-[#ecf5ef] text-[#83ad95]",
          },
        ].map((m) => (
          <Card className="p-5" key={m.label}>
            <div className="flex items-center justify-between">
              <p className="text-[11px] text-muted-foreground">{m.label}</p>
              <span
                className={cn(
                  "flex size-8 items-center justify-center rounded-lg dark:bg-muted",
                  m.bg
                )}
              >
                <m.icon size={16} />
              </span>
            </div>
            <p className="mt-1 text-[27px] font-semibold tracking-tight">
              {m.value}
            </p>
            <p className="mt-2 text-[10px] text-muted-foreground">{m.detail}</p>
          </Card>
        ))}
      </div>
      <div className="mb-5 flex gap-6 border-b">
        {[
          { id: "overview", label: "Overview" },
          { id: "shop", label: "Community shop" },
          { id: "transactions", label: "Transaction history" },
        ].map((t) => (
          <button
            className={cn(
              "-mb-px border-b-2 pb-3 pt-1 text-[12px] font-medium",
              tab === t.id
                ? "border-primary text-primary"
                : "border-transparent text-muted-foreground"
            )}
            key={t.id}
            onClick={() => {
              setTab(t.id);
              setQuery("");
            }}
          >
            {t.label}
          </button>
        ))}
      </div>
      {tab === "overview" ? (
        <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_320px]">
          <Card>
            <div className="flex items-center justify-between border-b px-5 py-4">
              <h2 className="text-xs font-semibold">
                A constellation of contributors
              </h2>
              <Badge tone="amber">
                <Trophy size={10} />
                Leaderboard
              </Badge>
            </div>
            <DataTable
              rows={data.accounts.map((a, i) => ({
                ...a,
                id: a.userId,
                rank: i + 1,
              }))}
              columns={[
                {
                  key: "rank",
                  label: "Rank",
                  render: (r) => (
                    <span
                      className={cn(
                        "flex size-6 items-center justify-center rounded-full text-[11px] font-semibold",
                        r.rank === 1
                          ? "bg-amber-50 text-amber-500"
                          : r.rank === 2
                            ? "bg-slate-100 text-slate-500"
                            : r.rank === 3
                              ? "bg-orange-50 text-orange-400"
                              : "text-muted-foreground"
                      )}
                    >
                      {r.rank <= 3 ? <Medal size={14} /> : r.rank}
                    </span>
                  ),
                },
                {
                  key: "member",
                  label: "Member",
                  render: (r) => (
                    <span className="flex items-center gap-2.5">
                      <span className="flex size-7 items-center justify-center rounded-full bg-violet-50 text-violet-400 dark:bg-violet-500/10">
                        {r.name.slice(0, 1)}
                      </span>
                      <span className="font-medium">
                        {r.name}
                        {r.userId === data.user.id && (
                          <span className="ml-1.5 text-[9px] text-muted-foreground">
                            you
                          </span>
                        )}
                      </span>
                    </span>
                  ),
                },
                {
                  key: "balance",
                  label: "Balance",
                  render: (r) => (
                    <span className="font-medium tabular-nums text-[#bc9c55]">
                      {ec.symbol} {number(r.balance)}
                    </span>
                  ),
                },
              ]}
              emptyTitle="Every constellation starts with one star"
              emptyDescription="Members will appear here after earning their first daily or activity reward."
            />
          </Card>
          <div className="space-y-5">
            <Card className="relative overflow-hidden border-violet-200/50 bg-gradient-to-br from-[#f1eafa] via-card to-card p-6 dark:from-violet-500/10 dark:to-card">
              <div className="absolute -right-9 -top-9 size-36 rounded-full border-[16px] border-violet-200/20" />
              <div className="relative">
                <span className="flex items-center gap-2 text-[11px] font-medium text-[#9a7fc0]">
                  <Sparkles size={14} />
                  Your little corner of the cosmos
                </span>
                <p className="mt-6 text-[11px] text-muted-foreground">
                  Your balance
                </p>
                <p className="mt-1 text-[34px] font-semibold tracking-[-1px]">
                  <span className="mr-2 text-[#ba9a62]">{ec.symbol}</span>
                  {number(me?.balance ?? 0)}
                </p>
                <p className="mt-1 text-[11px] text-muted-foreground">
                  {ec.currency}
                </p>
                <Button
                  className="mt-6 w-full"
                  disabled={
                    busy || !dailyReady || !data.guild.config.modules.economy
                  }
                  onClick={claimDaily}
                >
                  {busy ? (
                    <Spinner />
                  ) : dailyReady ? (
                    <Gift size={14} />
                  ) : (
                    <Check size={14} />
                  )}
                  {dailyReady
                    ? `Claim ${number(ec.dailyAmount)} daily ${ec.currency}`
                    : "All set for today. See you tomorrow!"}
                </Button>
                <Button
                  variant="outline"
                  className="mt-2.5 w-full"
                  onClick={() => setTransfer(true)}
                  disabled={!ec.transferEnabled}
                >
                  <Send size={13} />
                  Send a little appreciation
                </Button>
              </div>
            </Card>
            <Card className="p-5">
              <div className="mb-2 flex items-center gap-2 text-[12px] font-semibold">
                <ShieldCheck size={14} className="text-emerald-500" />
                Fair by design.
              </div>
              <p className="text-[11px] leading-relaxed text-muted-foreground">
                Every reward and transfer is recorded. Atomic transactions mean
                no double claims, no negative balances, and no lost little
                thank-yous.
              </p>
              <p className="mt-3 border-t pt-3 text-[10px] text-muted-foreground">
                Virtual currency only. No cash value. No gambling.
              </p>
            </Card>
          </div>
        </div>
      ) : (
        <>
          <div className="mb-4 flex items-center justify-between gap-3">
            <SearchInput
              value={query}
              onChange={setQuery}
              placeholder={
                tab === "shop"
                  ? "Find a little something…"
                  : "Search transactions…"
              }
            />
            {tab === "transactions" && (
              <Select
                value={filter}
                onChange={(e) => setFilter(e.target.value)}
                className="h-9 w-36 text-[11px]"
                aria-label="Transaction type"
              >
                <option value="all">All transactions</option>
                {["daily", "activity", "transfer", "purchase"].map((t) => (
                  <option key={t}>{t}</option>
                ))}
              </Select>
            )}
          </div>
          {tab === "shop" ? (
            shop.length ? (
              <div className="grid gap-5 sm:grid-cols-2 xl:grid-cols-3">
                {shop.map((item) => (
                  <Card key={item.id} className="flex flex-col p-5">
                    <div className="flex items-start justify-between">
                      <span className="flex size-14 items-center justify-center rounded-2xl border border-amber-100/60 bg-gradient-to-br from-amber-50 to-orange-50 text-2xl dark:border-amber-500/10 dark:from-amber-500/10 dark:to-orange-500/5">
                        {item.data.emoji}
                      </span>
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button
                            variant="ghost"
                            size="icon"
                            aria-label={`Actions for ${item.name}`}
                          >
                            <MoreHorizontal size={16} />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent>
                          <DropdownMenuItem onSelect={() => setEditor(item)}>
                            <Pencil />
                            Edit shop item
                          </DropdownMenuItem>
                          <DropdownMenuItem
                            onSelect={async () => {
                              try {
                                await api(
                                  `/resources/shop/${item.id}`,
                                  "PATCH",
                                  {
                                    name: item.name,
                                    data: item.data,
                                    enabled: !item.enabled,
                                  }
                                );
                                await refresh();
                                toast.success(
                                  item.enabled ? "Item paused" : "Item enabled"
                                );
                              } catch (e: any) {
                                toast.error(e.message);
                              }
                            }}
                          >
                            <RefreshCw />
                            {item.enabled ? "Pause" : "Enable"} item
                          </DropdownMenuItem>
                          <DropdownMenuSeparator />
                          <DropdownMenuItem
                            className="text-red-500"
                            onSelect={() => setDeleting(item)}
                          >
                            <Trash2 />
                            Delete item
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </div>
                    <div className="mt-5 flex items-center gap-2">
                      <h2 className="text-sm font-semibold">{item.name}</h2>
                      {!item.enabled && <Badge>Paused</Badge>}
                    </div>
                    <p className="mt-2 min-h-12 text-[12px] leading-relaxed text-muted-foreground">
                      {item.data.description}
                    </p>
                    <div className="mt-4 flex items-center gap-2">
                      <Badge tone="purple">
                        {item.data.type === "role"
                          ? "Role reward"
                          : "Virtual item"}
                      </Badge>
                      <span className="text-[10px] text-muted-foreground">
                        {item.data.stock < 0
                          ? "Always in stock"
                          : `${item.data.stock} left`}
                      </span>
                    </div>
                    <div className="mt-5 flex items-center justify-between border-t pt-4">
                      <span className="text-sm font-semibold text-[#b89a5e]">
                        {ec.symbol} {number(item.data.price)}
                      </span>
                      <Button
                        variant="outline"
                        size="sm"
                        disabled={!item.enabled || item.data.stock === 0}
                        onClick={() => {
                          setPurchase(item);
                          setKey(crypto.randomUUID());
                        }}
                      >
                        <ShoppingBag size={12} />
                        {data.demo ? "Try a purchase" : "Buy item"}
                      </Button>
                    </div>
                  </Card>
                ))}
              </div>
            ) : (
              <Card>
                <EmptyState
                  icon={ShoppingBag}
                  title="A little something to look forward to."
                  description="Create role rewards, virtual items, and community perks that your members can earn."
                  action={
                    <Button onClick={() => setEditor(null)}>
                      <Plus />
                      Add your first shop item
                    </Button>
                  }
                />
              </Card>
            )
          ) : (
            <Card>
              <HistoryTable<LedgerEntry>
                kind="ledger"
                query={query}
                filter={filter}
                columns={[
                  {
                    key: "member",
                    label: "Member",
                    render: (r) => (
                      <span className="font-medium">
                        {data.accounts.find((a) => a.userId === r.userId)
                          ?.name ?? r.userId}
                      </span>
                    ),
                  },
                  {
                    key: "type",
                    label: "Type",
                    render: (r) => (
                      <Badge
                        tone={
                          r.type === "daily"
                            ? "purple"
                            : r.type === "purchase"
                              ? "amber"
                              : "neutral"
                        }
                      >
                        {r.type}
                      </Badge>
                    ),
                  },
                  {
                    key: "note",
                    label: "Details",
                    render: (r) => (
                      <span className="text-muted-foreground">{r.note}</span>
                    ),
                  },
                  {
                    key: "amount",
                    label: "Amount",
                    render: (r) => (
                      <span
                        className={cn(
                          "flex items-center gap-1 font-medium tabular-nums",
                          r.amount > 0
                            ? "text-emerald-600"
                            : "text-muted-foreground"
                        )}
                      >
                        {r.amount > 0 ? "+" : "−"}
                        {ec.symbol} {number(Math.abs(r.amount))}
                      </span>
                    ),
                  },
                  {
                    key: "time",
                    label: "When",
                    render: (r) => (
                      <span className="whitespace-nowrap text-muted-foreground">
                        {relativeTime(
                          r.createdAt,
                          data.presentation.referenceAt
                        )}
                      </span>
                    ),
                  },
                ]}
                emptyTitle="Every little transaction tells a story"
                emptyDescription="Claims, purchases, activity rewards, and both sides of transfers will appear here. This ledger is append-only."
              />
            </Card>
          )}
        </>
      )}
      {editor !== undefined && (
        <ResourceEditor
          kind="shop"
          resource={editor}
          onClose={() => setEditor(undefined)}
        />
      )}
      {transfer && <TransferDialog onClose={() => setTransfer(false)} />}
      {settings && <EconomySettings onClose={() => setSettings(false)} />}
      <Dialog
        open={!!purchase}
        onOpenChange={(o) => {
          if (!o && !busy) setPurchase(null);
        }}
      >
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>A little treat for your orbit.</DialogTitle>
            <DialogDescription>
              Buy {purchase?.name} for {ec.symbol}{" "}
              {number(purchase?.data.price ?? 0)}? This will use your own
              community balance, not the server treasury.
            </DialogDescription>
          </DialogHeader>
          <div className="mb-5 flex items-center justify-between rounded-xl bg-muted p-4 text-xs">
            <span className="text-muted-foreground">
              Your balance after purchase
            </span>
            <span
              className={cn(
                "font-semibold",
                (me?.balance ?? 0) - (purchase?.data.price ?? 0) < 0
                  ? "text-red-500"
                  : "text-foreground"
              )}
            >
              {ec.symbol}{" "}
              {number((me?.balance ?? 0) - (purchase?.data.price ?? 0))}
            </span>
          </div>
          <div className="flex justify-end gap-2">
            <Button
              variant="outline"
              onClick={() => setPurchase(null)}
              disabled={busy}
            >
              Maybe later
            </Button>
            <Button
              disabled={busy}
              onClick={async () => {
                if (!purchase) return;
                setBusy(true);
                try {
                  await api(
                    "/economy/purchase",
                    "POST",
                    { itemId: purchase.id },
                    { "idempotency-key": key }
                  );
                  await refresh();
                  toast.success(`A little more ${purchase.name} in your life.`);
                  setPurchase(null);
                } catch (e: any) {
                  toast.error(e.message);
                } finally {
                  setBusy(false);
                }
              }}
            >
              {busy ? <Spinner /> : <ShoppingBag size={14} />}Confirm purchase
            </Button>
          </div>
        </DialogContent>
      </Dialog>
      <Dialog
        open={!!deleting}
        onOpenChange={(o) => {
          if (!o) setDeleting(null);
        }}
      >
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Remove this little reward?</DialogTitle>
            <DialogDescription>
              “{deleting?.name}” will leave the shop. Existing purchases and
              ledger records will remain.
            </DialogDescription>
          </DialogHeader>
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => setDeleting(null)}>
              Keep it
            </Button>
            <Button
              variant="destructive"
              disabled={busy}
              onClick={async () => {
                if (!deleting) return;
                setBusy(true);
                try {
                  await api(`/resources/shop/${deleting.id}`, "DELETE");
                  await refresh();
                  toast.success("Shop item deleted");
                  setDeleting(null);
                } catch (e: any) {
                  toast.error(e.message);
                } finally {
                  setBusy(false);
                }
              }}
            >
              {busy ? <Spinner /> : <Trash2 size={13} />}Delete item
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
function TransferDialog({ onClose }: { onClose: () => void }) {
  const { data, api, refresh } = useWorkspace();
  const [to, setTo] = useState(
    data.accounts.find((a) => a.userId !== data.user.id)?.userId ?? ""
  );
  const [amount, setAmount] = useState(100);
  const [note, setNote] = useState("A little thank-you");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [key] = useState(() => crypto.randomUUID());
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      await api(
        "/economy/transfer",
        "POST",
        { toUserId: to, amount, note },
        { "idempotency-key": key }
      );
      await refresh();
      toast.success("A little appreciation, delivered.");
      onClose();
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <Dialog
      open
      onOpenChange={(o) => {
        if (!o && !busy) onClose();
      }}
    >
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>A little appreciation goes a long way.</DialogTitle>
          <DialogDescription>
            Send {data.guild.config.economy.currency} to someone in your
            community.
          </DialogDescription>
        </DialogHeader>
        <form className="space-y-5" onSubmit={submit}>
          <Field label="Send to" required>
            {data.demo ? (
              <Select value={to} onChange={(e) => setTo(e.target.value)}>
                {data.accounts
                  .filter((a) => a.userId !== data.user.id)
                  .map((a) => (
                    <option key={a.userId} value={a.userId}>
                      {a.name}
                    </option>
                  ))}
              </Select>
            ) : (
              <Input
                required
                pattern="\d{17,20}"
                placeholder="Discord member ID"
                value={to}
                onChange={(e) => setTo(e.target.value)}
              />
            )}
          </Field>
          <Field label="Amount" required>
            <Input
              type="number"
              min="1"
              max="100000000"
              required
              value={amount}
              onChange={(e) => setAmount(Number(e.target.value))}
            />
          </Field>
          <Field label="A little note">
            <Input
              value={note}
              maxLength={200}
              onChange={(e) => setNote(e.target.value)}
            />
          </Field>
          {error && (
            <p
              className="rounded-lg bg-red-50 p-3 text-xs text-red-600"
              role="alert"
            >
              {error}
            </p>
          )}
          <div className="flex justify-end gap-2 border-t pt-4">
            <Button
              type="button"
              variant="outline"
              onClick={onClose}
              disabled={busy}
            >
              Cancel
            </Button>
            <Button disabled={busy}>
              {busy ? <Spinner /> : <Send size={13} />}Send {number(amount)}{" "}
              {data.guild.config.economy.symbol}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
function EconomySettings({ onClose }: { onClose: () => void }) {
  const { data, saveConfig } = useWorkspace();
  const [v, setV] = useState(data.guild.config.economy);
  const [busy, setBusy] = useState(false);
  return (
    <Dialog
      open
      onOpenChange={(o) => {
        if (!o) onClose();
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Make your economy feel like you.</DialogTitle>
          <DialogDescription>
            Small rewards for the people who bring your community to life.
          </DialogDescription>
        </DialogHeader>
        <form
          className="space-y-5"
          onSubmit={async (e) => {
            e.preventDefault();
            setBusy(true);
            try {
              await saveConfig({ ...data.guild.config, economy: v });
              toast.success("Economy settings saved");
              onClose();
            } catch (e: any) {
              toast.error(e.message);
            } finally {
              setBusy(false);
            }
          }}
        >
          <div className="grid grid-cols-[1fr_100px] gap-4">
            <Field label="Currency name">
              <Input
                required
                maxLength={24}
                value={v.currency}
                onChange={(e) => setV({ ...v, currency: e.target.value })}
              />
            </Field>
            <Field label="Symbol">
              <Input
                required
                maxLength={4}
                value={v.symbol}
                onChange={(e) => setV({ ...v, symbol: e.target.value })}
              />
            </Field>
          </div>
          <Field
            label="Daily reward amount"
            hint="One claim per member, every rolling 24 hours."
          >
            <Input
              type="number"
              min="0"
              max="100000"
              value={v.dailyAmount}
              onChange={(e) =>
                setV({ ...v, dailyAmount: Number(e.target.value) })
              }
            />
          </Field>
          <div className="grid grid-cols-2 gap-4">
            <Field label="Activity reward amount">
              <Input
                type="number"
                min="0"
                max="1000"
                value={v.activityAmount}
                onChange={(e) =>
                  setV({ ...v, activityAmount: Number(e.target.value) })
                }
              />
            </Field>
            <Field label="Cooldown (seconds)">
              <Input
                type="number"
                min="30"
                max="86400"
                value={v.activityCooldown}
                onChange={(e) =>
                  setV({ ...v, activityCooldown: Number(e.target.value) })
                }
              />
            </Field>
          </div>
          <div className="flex items-center justify-between rounded-lg border p-4">
            <div>
              <p className="text-xs font-medium">A little sharing</p>
              <p className="mt-1 text-[11px] text-muted-foreground">
                Allow member-to-member transfers.
              </p>
            </div>
            <Switch
              checked={v.transferEnabled}
              onCheckedChange={(b) => setV({ ...v, transferEnabled: b })}
              aria-label="Allow transfers"
            />
          </div>
          <Button className="w-full" disabled={busy}>
            {busy ? <Spinner /> : <Check size={14} />}Save economy settings
          </Button>
        </form>
      </DialogContent>
    </Dialog>
  );
}
