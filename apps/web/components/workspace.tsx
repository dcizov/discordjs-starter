"use client";
import type { DashboardData, GuildConfig } from "@orbit/core";
import { createContext, useContext } from "react";
export type Workspace = {
  data: DashboardData;
  refresh: () => Promise<void>;
  api: <T = any>(
    path: string,
    method?: string,
    body?: unknown,
    headers?: Record<string, string>,
    /**
     * `signal` aborts the underlying request; `awaitJob: false` returns as soon
     * as a bot action is queued instead of blocking on it, which is what long
     * work (template capture/apply) needs.
     */
    options?: { signal?: AbortSignal; awaitJob?: boolean }
  ) => Promise<T>;
  saveConfig: (config: GuildConfig, optimistic?: boolean) => Promise<void>;
  /**
   * Move to another section, optionally carrying query state.
   *
   * The query exists so one surface can hand another a starting point — the
   * roles view sends `roleId` to the member directory, which lands already
   * narrowed to that role's holders. It is how the connected views keep the
   * operator's place instead of dropping them on a fresh, empty page.
   */
  navigate: (section: string, query?: Record<string, string>) => void;
  setData: React.Dispatch<React.SetStateAction<DashboardData>>;
};
export const WorkspaceContext = createContext<Workspace | null>(null);
export function useWorkspace() {
  const ctx = useContext(WorkspaceContext);
  if (!ctx) throw new Error("Workspace is not available");
  return ctx;
}
