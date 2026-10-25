"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { ChevronDown, RefreshCw, ShieldCheck, LogOut } from "lucide-react";
import { toast } from "sonner";
import type { DashboardData } from "@orbit/core";
import { request } from "@/lib/utils";
import { useWorkspace } from "../workspace";
import { IdentityImage } from "./image";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "../ui/dropdown-menu";
export function AccountMenu({ onModeInfo }: { onModeInfo: () => void }) {
  const { data, setData } = useWorkspace();
  const router = useRouter();
  const [profileBusy, setProfileBusy] = useState(false);
  async function refreshUserProfile() {
    setProfileBusy(true);
    try {
      const result = await request<{ user: DashboardData["user"] }>(
        "/api/auth/profile",
        "POST",
        {}
      );
      if (result.user.id !== data.user.id) {
        // A sign-in in another tab requires a new server authorization boundary.
        router.refresh();
        return;
      }
      setData((current) => ({ ...current, user: result.user }));
      toast.success(
        data.demo
          ? "Demo profile — Discord was not contacted"
          : "Discord profile metadata refreshed"
      );
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Profile refresh failed"
      );
    } finally {
      setProfileBusy(false);
    }
  }
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          className="flex items-center gap-2.5"
          aria-label={`Account menu for ${data.user.name}`}
        >
          <IdentityImage
            id={data.user.id}
            name={data.user.name}
            src={data.user.avatarUrl}
            kind="user"
            size={30}
          />
          <ChevronDown
            size={12}
            className="hidden text-muted-foreground sm:block"
          />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent>
        <div className="px-3 py-2">
          <p className="text-xs font-semibold">{data.user.name}</p>
          <p className="mt-1 text-[11px] text-muted-foreground">
            {data.demo
              ? "Demo administrator · sample image"
              : "Global Discord profile"}
          </p>
        </div>
        <DropdownMenuSeparator />
        <DropdownMenuItem
          disabled={profileBusy}
          onSelect={() => void refreshUserProfile()}
        >
          <RefreshCw />
          {profileBusy ? "Refreshing profile…" : "Refresh profile image & name"}
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={() => onModeInfo()}>
          <ShieldCheck />
          Privacy & permissions
        </DropdownMenuItem>
        <DropdownMenuItem
          onSelect={async () => {
            try {
              await request("/api/auth/logout", "POST", {});
              router.push("/login");
            } catch (e: any) {
              toast.error(e.message);
            }
          }}
        >
          <LogOut />
          Sign out
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
