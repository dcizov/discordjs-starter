import { PermissionFlagsBits, SlashCommandBuilder } from "discord.js";
const command = (name: string, description: string) =>
  new SlashCommandBuilder()
    .setName(name)
    .setDescription(description)
    .setDMPermission(false);
const moderation = (name: string, description: string, permission: bigint) =>
  command(name, description)
    .setDefaultMemberPermissions(permission)
    .addUserOption((o) =>
      o.setName("member").setDescription("Member to moderate").setRequired(true)
    )
    .addStringOption((o) =>
      o
        .setName("reason")
        .setDescription("A clear reason for the case record")
        .setMinLength(1)
        .setMaxLength(500)
        .setRequired(true)
    );
export const commandDefinitions = [
  command("ping", "Check Orbit’s gateway connection"),
  command("roles", "Find your community’s self-role panels"),
  command("role-panel", "Publish or refresh a role panel")
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageRoles)
    .addStringOption((o) =>
      o
        .setName("panel")
        .setDescription("Panel UUID from the dashboard")
        .setRequired(true)
        .setAutocomplete(true)
    ),
  moderation(
    "warn",
    "Record a warning for a member",
    PermissionFlagsBits.ModerateMembers
  ),
  moderation(
    "timeout",
    "Give a member a little time to cool off",
    PermissionFlagsBits.ModerateMembers
  ).addIntegerOption((o) =>
    o
      .setName("minutes")
      .setDescription("Duration in minutes (up to 28 days)")
      .setMinValue(1)
      .setMaxValue(40320)
      .setRequired(true)
  ),
  moderation(
    "kick",
    "Remove a member from this server",
    PermissionFlagsBits.KickMembers
  ),
  moderation(
    "ban",
    "Ban a member from this server",
    PermissionFlagsBits.BanMembers
  ),
  command("purge", "Remove recent messages (less than 14 days old)")
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageMessages)
    .addIntegerOption((o) =>
      o
        .setName("amount")
        .setDescription("Messages to remove")
        .setMinValue(1)
        .setMaxValue(100)
        .setRequired(true)
    ),
  command("cases", "View recent moderation cases")
    .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers)
    .addUserOption((o) =>
      o.setName("member").setDescription("Filter to a member")
    ),
  command("balance", "See your community currency balance").addUserOption((o) =>
    o.setName("member").setDescription("View another member’s balance")
  ),
  command("daily", "Claim your daily community reward"),
  command("transfer", "Send a little appreciation to another member")
    .addUserOption((o) =>
      o.setName("member").setDescription("Recipient").setRequired(true)
    )
    .addIntegerOption((o) =>
      o
        .setName("amount")
        .setDescription("Whole currency units")
        .setMinValue(1)
        .setMaxValue(100000000)
        .setRequired(true)
    ),
  command("leaderboard", "Meet the community’s top contributors"),
  command("shop", "Browse, buy, or reclaim community rewards")
    .addSubcommand((s) =>
      s.setName("list").setDescription("Browse the community shop")
    )
    .addSubcommand((s) =>
      s
        .setName("buy")
        .setDescription("Buy a role or virtual item")
        .addStringOption((o) =>
          o
            .setName("item")
            .setDescription("Shop item")
            .setRequired(true)
            .setAutocomplete(true)
        )
    )
    .addSubcommand((s) =>
      s
        .setName("claim")
        .setDescription("Restore a purchased role without paying again")
        .addStringOption((o) =>
          o
            .setName("item")
            .setDescription("Purchased role item")
            .setRequired(true)
            .setAutocomplete(true)
        )
    ),
  command("inventory", "View your purchased community rewards"),
  command(
    "play",
    "Add a track from a configured, supported audio source"
  ).addStringOption((o) =>
    o
      .setName("query")
      .setDescription("Track search or supported source URL")
      .setMinLength(2)
      .setMaxLength(200)
      .setRequired(true)
  ),
  command("queue", "See what’s playing and what’s up next"),
  command("pause", "Pause the listening room"),
  command("resume", "Resume the listening room"),
  command("skip", "Skip the current track"),
  command("stop", "Stop playback and clear the queue"),
  command("shuffle", "Shuffle the listening room queue"),
  command("volume", "Set the listening room’s volume").addIntegerOption((o) =>
    o
      .setName("level")
      .setDescription("Volume percentage")
      .setMinValue(0)
      .setMaxValue(100)
      .setRequired(true)
  ),
  command("repeat", "Set the queue repeat mode").addStringOption((o) =>
    o
      .setName("mode")
      .setDescription("Repeat mode")
      .setRequired(true)
      .addChoices(
        { name: "Off", value: "off" },
        { name: "Current track", value: "track" },
        { name: "Entire queue", value: "queue" }
      )
  ),
  command("deals", "Find good games at better prices")
    .addSubcommand((s) =>
      s
        .setName("search")
        .setDescription("Search IsThereAnyDeal")
        .addStringOption((o) =>
          o
            .setName("query")
            .setDescription("Game title")
            .setRequired(true)
            .setMinLength(2)
            .setMaxLength(100)
        )
    )
    .addSubcommand((s) =>
      s
        .setName("watch")
        .setDescription("Create a game watchlist (Manage Server required)")
        .addStringOption((o) =>
          o
            .setName("game")
            .setDescription("IsThereAnyDeal game UUID from /deals search")
            .setRequired(true)
        )
        .addStringOption((o) =>
          o
            .setName("name")
            .setDescription("Game title")
            .setRequired(true)
            .setMaxLength(80)
        )
        .addChannelOption((o) =>
          o
            .setName("channel")
            .setDescription("Deal alerts destination")
            .setRequired(true)
        )
    ),
  command("news", "Check your connected news sources")
    .addSubcommand((s) =>
      s.setName("list").setDescription("List configured sources")
    )
    .addSubcommand((s) =>
      s
        .setName("test")
        .setDescription(
          "Test a news source without delivering (Manage Server required)"
        )
        .addStringOption((o) =>
          o
            .setName("source")
            .setDescription("Source UUID")
            .setRequired(true)
            .setAutocomplete(true)
        )
    ),
];
