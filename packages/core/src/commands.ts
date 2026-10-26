import {
  ChannelType,
  PermissionFlagsBits,
  SlashCommandBuilder,
  type SlashCommandStringOption,
} from "discord.js";
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
const dealCountry = (o: SlashCommandStringOption) =>
  o
    .setName("country")
    .setDescription("Regional offers and currency (default Germany / EUR)")
    .addChoices(
      { name: "Germany · EUR", value: "DE" },
      { name: "United States · USD", value: "US" },
      { name: "United Kingdom · GBP", value: "GB" },
      { name: "Canada · CAD", value: "CA" },
      { name: "Australia · AUD", value: "AU" }
    );
export const commandDefinitions = [
  command(
    "transactions",
    "Privately view your own economy history in this server"
  ).addIntegerOption((o) =>
    o
      .setName("page")
      .setDescription("History page (10 entries per page)")
      .setMinValue(1)
      .setMaxValue(10000)
  ),
  command("ping", "Check Orbit’s gateway connection"),
  command(
    "help",
    "List Orbit’s commands, or explain one in detail"
  ).addStringOption((o) =>
    o
      .setName("command")
      .setDescription("A command name, e.g. play")
      .setAutocomplete(true)
  ),
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
  command(
    "search",
    "Search a source and choose exactly which track to queue"
  ).addStringOption((o) =>
    o
      .setName("query")
      .setDescription("What should Orbit look for?")
      .setMinLength(1)
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
  command("seek", "Jump to a position in the current track").addIntegerOption(
    (o) =>
      o
        .setName("position")
        .setDescription("Seconds from the start of the track")
        .setMinValue(1)
        .setMaxValue(86400)
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
  command("deals", "Find familiar games at better prices")
    .addSubcommand((s) =>
      s
        .setName("search")
        .setDescription(
          "Find base games with images, ratings and regional offers"
        )
        .addStringOption((o) =>
          o
            .setName("query")
            .setDescription("Game title")
            .setRequired(true)
            .setMinLength(2)
            .setMaxLength(100)
        )
        .addStringOption(dealCountry)
        .addIntegerOption((o) =>
          o
            .setName("results")
            .setDescription("Rich game cards (default 3)")
            .setMinValue(1)
            .setMaxValue(3)
        )
    )
    .addSubcommand((s) =>
      s
        .setName("info")
        .setDescription("Game artwork, ratings, players and a current offer")
        .addStringOption((o) =>
          o
            .setName("game")
            .setDescription(
              "Choose by title after /deals search, or enter an ITAD game ID"
            )
            .setRequired(true)
            .setAutocomplete(true)
        )
        .addStringOption(dealCountry)
    )
    .addSubcommand((s) =>
      s
        .setName("now")
        .setDescription(
          "Preview popular-game deals; does not post to a channel"
        )
        .addStringOption(dealCountry)
    )
    .addSubcommand((s) =>
      s
        .setName("watch")
        .setDescription("Watch one game (Manage Server required)")
        .addStringOption((o) =>
          o
            .setName("game")
            .setDescription(
              "Choose by title after /deals search, or enter an ITAD game ID"
            )
            .setRequired(true)
            .setAutocomplete(true)
        )
        .addChannelOption((o) =>
          o
            .setName("channel")
            .setDescription("Deal alerts destination")
            .addChannelTypes(
              ChannelType.GuildText,
              ChannelType.GuildAnnouncement
            )
            .setRequired(true)
        )
        .addStringOption(dealCountry)
    )
    .addSubcommand((s) =>
      s
        .setName("feed")
        .setDescription(
          "Configure automatic popular-game posts (Manage Server)"
        )
        .addChannelOption((o) =>
          o
            .setName("channel")
            .setDescription("Automatic deals destination")
            .addChannelTypes(
              ChannelType.GuildText,
              ChannelType.GuildAnnouncement
            )
            .setRequired(true)
        )
        .addStringOption(dealCountry)
        .addIntegerOption((o) =>
          o
            .setName("min-discount")
            .setDescription("Minimum percent discount (default 50)")
            .setMinValue(1)
            .setMaxValue(100)
        )
        .addNumberOption((o) =>
          o
            .setName("max-price")
            .setDescription("Maximum price in regional currency (default 60)")
            .setMinValue(0)
            .setMaxValue(10000)
        )
        .addIntegerOption((o) =>
          o
            .setName("min-reviews")
            .setDescription("Minimum Steam reviews (default 10000)")
            .setMinValue(1000)
            .setMaxValue(10000000)
        )
        .addIntegerOption((o) =>
          o
            .setName("min-score")
            .setDescription("Minimum Steam positive percentage (default 70)")
            .setMinValue(0)
            .setMaxValue(100)
        )
        .addIntegerOption((o) =>
          o
            .setName("min-players")
            .setDescription(
              "Minimum recent Steam players via ITAD (default no minimum)"
            )
            .setMinValue(0)
            .setMaxValue(10000000)
        )
        .addIntegerOption((o) =>
          o
            .setName("popular-rank")
            .setDescription("Top N ITAD waitlists + collections (default 500)")
            .setMinValue(1)
            .setMaxValue(500)
        )
        .addIntegerOption((o) =>
          o
            .setName("interval")
            .setDescription("Minutes between checks (default 60)")
            .setMinValue(15)
            .setMaxValue(1440)
        )
        .addIntegerOption((o) =>
          o
            .setName("max-posts")
            .setDescription("Maximum NEW posts per check (default 3)")
            .setMinValue(1)
            .setMaxValue(5)
        )
    )
    .addSubcommand((s) =>
      s
        .setName("pause")
        .setDescription("Pause automatic feed in a channel (Manage Server)")
        .addChannelOption((o) =>
          o
            .setName("channel")
            .setDescription("Deals channel")
            .addChannelTypes(
              ChannelType.GuildText,
              ChannelType.GuildAnnouncement
            )
            .setRequired(true)
        )
    )
    .addSubcommand((s) =>
      s
        .setName("list")
        .setDescription(
          "Show this server's automatic feeds and popularity filters"
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
  ...(["poll", "announce"] as const).map((name) => {
    const root = command(
      name,
      name === "poll"
        ? "Manage native Discord polls created in Orbit"
        : "Manage one-time community announcements"
    ).setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild);
    root.addSubcommand((s) =>
      s
        .setName("list")
        .setDescription("List this server's stored posts (private response)")
    );
    const actions =
      name === "poll"
        ? ["publish", "refresh", "close"]
        : ["publish", "schedule", "cancel"];
    for (const action of actions)
      root.addSubcommand((s) => {
        s.setName(action)
          .setDescription(
            `${action[0].toUpperCase() + action.slice(1)} a saved ${name === "poll" ? "native poll" : "announcement"}`
          )
          .addStringOption((o) =>
            o
              .setName("post")
              .setDescription("Choose a saved post from this server")
              .setRequired(true)
              .setAutocomplete(true)
          );
        if (action === "schedule")
          s.addStringOption((o) =>
            o
              .setName("utc")
              .setDescription(
                "UTC ISO time, e.g. 2026-11-01T18:00:00Z (1 min–30 days ahead)"
              )
              .setMaxLength(30)
              .setRequired(true)
          );
        return s;
      });
    return root;
  }),
];
