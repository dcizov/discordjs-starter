import type { GuildConfig } from "@orbit/core";
import type {
  ChatInputCommandInteraction,
  Guild,
  GuildMember,
} from "discord.js";
import type { ReplyCard } from "../interactions/replies";

/** One acknowledged, freshly fetched member/config snapshot. No transport lifetime. */
export type CommandContext = {
  i: ChatInputCommandInteraction;
  guild: Guild;
  member: GuildMember;
  config: GuildConfig;
  reply: (content: string | ReplyCard) => Promise<unknown>;
};
