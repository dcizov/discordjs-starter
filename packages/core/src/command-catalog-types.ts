import type { GuildConfig } from "./types";

export type CommandModule = "general" | keyof GuildConfig["modules"];
export const commandModuleLabels: Record<CommandModule, string> = {
  general: "General",
  roles: "Self roles",
  moderation: "Moderation",
  economy: "Economy",
  music: "Music",
  deals: "Game deals",
  news: "News & feeds",
  polls: "Native polls",
  announcements: "Announcements",
  xp: "Leveling",
  tickets: "Tickets",
};
export type CommandArgument = {
  name: string;
  description: string;
  type: string;
  required: boolean;
  autocomplete: boolean;
  choices: { name: string; value: string | number }[];
  minLength: number | null;
  maxLength: number | null;
  minValue: number | null;
  maxValue: number | null;
};
export type CommandReference = {
  id: string;
  root: string;
  path: string;
  description: string;
  usage: string;
  module: CommandModule;
  moduleEnabled: boolean;
  serverOnly: boolean;
  defaultPermissions: { bitfield: string | null; names: string[] };
  runtimePermissions: string[];
  notes: string[];
  arguments: CommandArgument[];
};
export type CommandCatalog = {
  source: "registration-definitions";
  registrationVerified: false;
  rootCount: number;
  invocationCount: number;
  commands: CommandReference[];
};
