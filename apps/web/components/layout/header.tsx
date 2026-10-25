"use client";
import { useEffect, useState } from "react";
import { useTheme } from "next-themes";
import {
  ArrowRight,
  Bell,
  ChevronRight,
  Command,
  Menu,
  Moon,
  Search,
  Sun,
} from "lucide-react";
import { cn, relativeTime } from "@/lib/utils";
import { AccountMenu } from "../identity/account-menu";
import { Button } from "../ui/button";
import { Input } from "../ui/primitives";
import { useWorkspace } from "../workspace";
import { navigation } from "./navigation";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "../ui/dialog";
export function DashboardHeader({
  section,
  onOpenNavigation,
  onModeInfo,
}: {
  section: string;
  onOpenNavigation: () => void;
  onModeInfo: () => void;
}) {
  const { data, navigate } = useWorkspace();
  const { theme, setTheme } = useTheme();
  const [search, setSearch] = useState(false);
  const [searchTerm, setSearchTerm] = useState("");
  const [notifications, setNotifications] = useState(false);
  const current = navigation.find((n) => n.id === section) ?? navigation[0];
  const servicesHealthy =
    data.health.length > 0 &&
    data.health.every((service) => service.status === "healthy");
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key === "k") {
        e.preventDefault();
        setSearch((v) => !v);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  return (
    <>
      <header className="sticky top-0 z-20 flex h-[65px] items-center justify-between border-b border-border bg-card/95 px-5 backdrop-blur-lg md:px-8">
        <div className="flex items-center gap-3">
          <Button
            variant="ghost"
            size="icon"
            className="lg:hidden"
            aria-label="Open navigation"
            onClick={() => onOpenNavigation()}
          >
            <Menu size={20} />
          </Button>
          <span className="hidden text-[12px] text-muted-foreground sm:block">
            Workspace
          </span>
          <ChevronRight
            size={12}
            className="hidden text-muted-foreground/60 sm:block"
          />
          <span className="text-[12px] font-medium">{current.label}</span>
        </div>
        <div className="flex items-center gap-2 md:gap-3">
          <span className="mr-3 hidden items-center gap-1.5 text-[11px] text-muted-foreground xl:flex">
            <span
              className={cn(
                "size-1.5 rounded-full",
                servicesHealthy ? "bg-emerald-400" : "bg-amber-400"
              )}
            />
            {servicesHealthy
              ? "All systems operational"
              : data.health.length
                ? "Some services need attention"
                : "Status not reported"}
          </span>
          <button
            aria-label="Search dashboard"
            onClick={() => setSearch(true)}
            className="hidden items-center gap-6 rounded-md border px-2.5 py-1.5 text-muted-foreground md:flex"
          >
            <Search size={13} />
            <span className="flex items-center gap-0.5 text-[10px]">
              <Command size={10} />K
            </span>
          </button>
          <Button
            size="icon"
            variant="ghost"
            aria-label="Toggle color theme"
            onClick={() => setTheme(theme === "dark" ? "light" : "dark")}
          >
            <Sun className="dark:hidden" size={16} />
            <Moon className="hidden dark:block" size={16} />
          </Button>
          <Button
            size="icon"
            variant="ghost"
            aria-label="Notifications"
            className="relative"
            onClick={() => setNotifications(true)}
          >
            <Bell size={16} />
            {data.audit.length > 0 && (
              <span className="absolute right-2 top-1.5 size-1 rounded-full bg-primary ring-2 ring-card" />
            )}
          </Button>
          <div className="mx-1 h-5 w-px bg-border" />
          <AccountMenu onModeInfo={onModeInfo} />
        </div>
      </header>
      <Dialog open={search} onOpenChange={setSearch}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Find your way around</DialogTitle>
            <DialogDescription>
              Your community, one shortcut away.
            </DialogDescription>
          </DialogHeader>
          <div className="relative">
            <Search
              className="absolute left-3 top-3 text-muted-foreground"
              size={16}
            />
            <Input
              autoFocus
              placeholder="Search pages and configuration…"
              className="pl-10"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
            />
          </div>
          <div className="mt-3 space-y-1">
            {navigation
              .filter((n) =>
                n.label.toLowerCase().includes(searchTerm.toLowerCase())
              )
              .map((n) => (
                <button
                  key={n.id}
                  className="flex w-full items-center gap-3 rounded-lg px-3 py-3 text-left text-xs hover:bg-muted"
                  onClick={() => {
                    navigate(n.id);
                    setSearch(false);
                    setSearchTerm("");
                  }}
                >
                  <n.icon size={16} className="text-primary" />
                  {n.label}
                  <ArrowRight
                    size={13}
                    className="ml-auto text-muted-foreground"
                  />
                </button>
              ))}
            {!navigation.some((n) =>
              n.label.toLowerCase().includes(searchTerm.toLowerCase())
            ) && (
              <p className="py-8 text-center text-xs text-muted-foreground">
                No pages found. Try “roles” or “news”.
              </p>
            )}
          </div>
        </DialogContent>
      </Dialog>
      <Dialog open={notifications} onOpenChange={setNotifications}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Around your community</DialogTitle>
            <DialogDescription>
              The little things that keep everything moving.
            </DialogDescription>
          </DialogHeader>
          <div className="divide-y">
            {data.audit.slice(0, 6).map((a) => (
              <div key={a.id} className="flex gap-3 py-4">
                <span className="mt-1 size-2 shrink-0 rounded-full bg-primary/60" />
                <div>
                  <p className="text-xs">
                    <span className="font-medium">{a.actorName}</span>{" "}
                    {a.action} {a.target}
                  </p>
                  <p className="mt-1 text-[11px] text-muted-foreground">
                    {a.detail}
                  </p>
                  <p className="mt-2 text-[10px] text-muted-foreground">
                    {relativeTime(a.createdAt, data.presentation.referenceAt)}
                  </p>
                </div>
              </div>
            ))}
            {!data.audit.length && (
              <p className="py-8 text-center text-xs text-muted-foreground">
                All quiet for now. New activity will show up here.
              </p>
            )}
          </div>
          <Button
            variant="outline"
            className="mt-4 w-full"
            onClick={() => {
              navigate("audit");
              setNotifications(false);
            }}
          >
            View audit log
            <ArrowRight size={13} />
          </Button>
        </DialogContent>
      </Dialog>
    </>
  );
}
