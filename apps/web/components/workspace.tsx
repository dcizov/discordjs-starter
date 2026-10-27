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
  navigate: (section: string) => void;
  setData: React.Dispatch<React.SetStateAction<DashboardData>>;
};
export const WorkspaceContext = createContext<Workspace | null>(null);
export function useWorkspace() {
  const ctx = useContext(WorkspaceContext);
  if (!ctx) throw new Error("Workspace is not available");
  return ctx;
}
