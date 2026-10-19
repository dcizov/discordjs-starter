import { guild } from "./guild";
import { ping } from "./ping";
import type { Command } from "../types/command";

export const commands: Record<string, Command> = {
  guild,
  ping,
} as const;
