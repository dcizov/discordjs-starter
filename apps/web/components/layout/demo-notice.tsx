"use client";
import { useState } from "react";
import { ArrowUpRight, FlaskConical, X } from "lucide-react";
import { useWorkspace } from "../workspace";
export function DemoNotice({ onModeInfo }: { onModeInfo: () => void }) {
  const { data } = useWorkspace();
  const [visible, setVisible] = useState(true);
  if (!data.demo || !visible) return null;
  return (
    <div className="mb-6 flex min-h-[34px] items-center justify-between gap-3 rounded-lg border border-violet-200/40 bg-[#f1edfc] px-3.5 py-2 dark:border-violet-500/20 dark:bg-violet-500/10">
      <span className="flex items-center gap-2 text-[11px] text-violet-700 dark:text-violet-300">
        <FlaskConical
          size={13}
          className="text-violet-600 dark:text-violet-300"
        />
        <span>
          <strong className="font-medium text-violet-600 dark:text-violet-300">
            A little space to explore.
          </strong>
          <span className="hidden sm:inline">
            {" "}
            You’re in a demo workspace. Your changes are saved, not sent.
          </span>
        </span>
      </span>
      <div className="flex shrink-0 items-center gap-4">
        <button
          className="text-[10px] font-medium text-violet-700 hover:underline dark:text-violet-300"
          onClick={() => onModeInfo()}
        >
          About demo mode <ArrowUpRight className="ml-0.5 inline" size={10} />
        </button>
        <button
          aria-label="Dismiss demo notice"
          onClick={() => setVisible(false)}
          className="text-violet-400"
        >
          <X size={12} />
        </button>
      </div>
    </div>
  );
}
