import { ping } from "./ping";
import type { Command } from "../types/command";

export const commands: Record<string, Command> = {
  ping,
} as const;
