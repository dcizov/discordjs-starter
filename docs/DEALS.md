# Game deals: rich cards and automatic popular-game alerts

Live data comes from [IsThereAnyDeal's documented public API](https://docs.isthereanydeal.com/) (OpenAPI 2.11.0 reviewed on 2026-10-24). There is no scraping, hardcoded sale list, guessed artwork URL, made-up rating, or use of ITAD's internal endpoints.

## Update and register the commands

Keep your existing live `.env`, database and volumes. Set `ITAD_API_KEY` **server-side on bot, web and worker**; never put it in `NEXT_PUBLIC_*`, an embed, a URL or a chat message.

From the **Docker host**:

```sh
npm run dev:stack
# Registration is a REST-only one-off: this does NOT start a second gateway bot.
docker compose -f docker-compose.yml -f docker-compose.dev.yml --profile live --profile music run --rm --no-deps bot npm run commands:register
npm run dev:stack:logs
```

For host/editor development use `npm run commands:register` with the same application's environment. `DISCORD_GUILD_ID` selects fast development-guild registration; otherwise the existing registration script updates global commands. Register in the intended scope and remove obsolete registrations explicitly if changing scope. Definitions are not automatically registered by opening the dashboard or starting containers.

### Commands

| Command                                                    | What it does                                                                                                                                                                                                                                           |
| ---------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `/deals search query:Fallout country:DE`                   | Up to three rich **base-game** cards, instead of an eight-ID wall. Includes actual artwork, Steam rating/review count, current regional offer when available, historical-low evidence, recent-player snapshot and source links. `results` accepts 1–3. |
| `/deals info game:<UUID-from-search> country:DE`           | A detailed card: additional critic ratings when supplied, developer, release, tags, platforms/DRM, required voucher and expiry.                                                                                                                        |
| `/deals now`                                               | **Ephemeral, read-only** preview of popular-game offers using this server's first enabled general feed, or conservative defaults when none is configured. Never posts to a channel. Optional country selection previews that region.                   |
| `/deals feed channel:#game-deals`                          | **Manage Server:** create/update the automatic popular-game feed for that channel. Updating reuses its resource ID/history rather than creating another subscription.                                                                                  |
| `/deals pause channel:#game-deals`                         | **Manage Server:** pause general automatic feeds in that channel, preserving configuration/history. Explicit single-game watches are separate.                                                                                                         |
| `/deals list`                                              | Show this server's general feeds, destinations, intervals and popularity/review thresholds.                                                                                                                                                            |
| `/deals watch game:<UUID-from-search> channel:#game-deals` | **Manage Server:** deliberately watch one verified non-mature base game, even if it falls outside discovery's popularity thresholds. The title is loaded from ITAD rather than trusted from user input.                                                |

Search/info/now replies remain ephemeral and do not ping anyone. Their offer/compare buttons use ITAD-provided links, retaining affiliate parameters. A missing price is labeled **unavailable**, never silently `0` or "free"; missing artwork/ratings/players are not invented. Provider-reported zero prices are valid when actually supplied. Numbers for players are **ITAD snapshots**, not a live Steam API guarantee.

The default country is Germany/EUR. Slash choices also cover US/USD, GB/GBP, CA/CAD and AU/AUD. The dashboard supports additional configured country/currency pairs. Orbit never converts currencies: only quotes in the chosen currency qualify.

## Configure a channel for automatic posting

Example slash configuration:

```text
/deals feed channel:#game-deals country:DE min-discount:50 max-price:60 min-reviews:10000 min-score:70 popular-rank:500 max-posts:3 interval:60
```

The channel must belong to the current server. The actor needs **Manage Server**, and the bot needs **View Channel**, **Send Messages** and **Embed Links** in the destination. A normal text channel or an announcement channel is supported; posting is not automatic announcement cross-publication. The worker must be running (`Orbit workers are ready`); the gateway bot alone does not deliver scheduled offers.

Alternatively open **Game deals → Set up deal alerts** in the dashboard:

1. Give the subscription a name.
2. Leave the specific-game search unselected for an automatic popular-game feed.
3. Choose the **Destination channel**.
4. Set popularity/review/player thresholds, price/discount/store filters, maximum new posts per check, notification role and polling interval.
5. Save. Use the active switch to pause/resume, and delivery history/worker logs to inspect actual outcomes.

The worker discovers schedule changes during its minute-by-minute reconciliation. Subsequent checks follow the configured interval (minimum 15 minutes; default 60). Saving configuration is **not** proof a channel message was sent. Zero qualifying offers means zero posts; it does not cause the bot to fill the channel with unrelated games.

## What "games people know and play" means here

Automatic general discovery uses **all** these defaults, rather than merely sorting unknown games by 100% discount:

- **Top 500 ITAD popularity positions**, from the public `/stats/most-popular/v1` endpoint. ITAD explicitly defines this popularity as **waitlisted count + collected count**, not concurrent Steam player rank.
- At least **10,000 Steam reviews** and at least **70% positive**, verified from the public game-info response.
- **Base games only**: no DLC, packages, software/unknown types, or games marked mature. Authoritative game metadata must explicitly report `mature=false` before publication; unknown is not treated as safe.
- A real, unexpired discounted offer matching the configured country/currency, shops, minimum discount, maximum price and optional historical-low rule.
- Optional **minimum recent Steam players** via ITAD's public game-info response. Default `0` disables this extra floor so familiar older/single-player games are not excluded just for low current activity. If enabled and the data is missing, the game is excluded.

These are **measurable proxies**, not a promise every member has heard of every game. A widely played indie can qualify; "indie" is not equated with obscure. No manually invented AAA list, publisher whitelist or guessed player counts are used. Missing popularity/review evidence or an unavailable popularity endpoint **fails closed**: no arbitrary discount-list fallback.

Managers can change the cutoffs (review minimum at least 1,000; popularity pool at most 500). Explicit single-game watches are deliberate choices, not discovery, so they bypass the popularity/review thresholds; base-game, non-mature, region/price/expiry rules still apply. Content flags come from ITAD and do not certify suitability for every age/community.

## Useful extra details and safeguards

- **Real data:** cards use provider-returned artwork, rating source/count, prices, voucher, historical-low amount/currency and expiry. Prices/links are not rewritten and affiliate tags are retained. No absence is fabricated into a score/price of zero. Historical-low-only filters require comparable price data; a missing or different-currency low does not count.
- **Same presentation:** command cards and automatic channel posts use the shared deal presenter; scheduled posts include artwork/ratings and offer/compare buttons too.
- **Deduplication:** an offer identity uses game/shop/currency/price/coupon/known expiry, not ITAD's changing refresh timestamp. Unchanged offers are not reposted every poll. A lower price/new coupon/known new campaign expiry can produce a new event; when expiry is unknown, an identical returning offer remains suppressed. Existing transactional outbox reservations and Discord nonces protect retries.
- **Posting cap:** default **three new posts per check**, configurable 1–5, applied **after deduplication** so already-seen top results cannot starve later qualifying games. Discovery is bounded to two 200-item API pages and at most 40 metadata candidates per check.
- **Fresh authorization/configuration:** dispatch reloads the current server/module/resource/destination. Delivery rechecks the current thresholds, country, channel, pause/module state, quote age and expiry. Old queued records without verified metadata, quotes older than 24 hours, or records for a changed channel fail rather than posting outdated/unverified offers. No database/Redis reset is used.
- **Rate limits:** header authentication, in-flight request deduplication, bounded caches and at most four concurrent requests per client. Search/deal lists cache five minutes, info/popularity one hour, prices one minute. HTTP 429/`Retry-After` gates further requests; the worker also respects provider retry timing. Bot and worker are separate processes; account-wide quota still applies across all instances. Increase intervals/reduce subscriptions if your actual quota requires it.
- **Failures:** inspect the resource's `lastChecked`/`lastError`, delivery history and worker logs. A configured key is not a claim that it is valid/authorized. Permission errors, provider restrictions and missing data do not become fake successful posts.
- **Demo:** configuration can be saved to the isolated demo JSON store, but no live ITAD polling, Discord registration, channel messages or purchases occur. Demo does not need an API key. No checkout/purchase automation is implemented; verify final price, region, tax, coupon and license conditions at the store.

ITAD attribution is included. Follow [its terms](https://github.com/IsThereAnyDeal/API/blob/master/TERMS_OF_SERVICE.md), application-access rules and quota; private use beyond personal may require approval. Orbit is not affiliated with ITAD or a store.

## Public API fields reviewed

- `GET /games/search/v1`: base-game discovery and returned assets.
- `GET /games/info/v2`: assets, reviews/source/count, developers, tags, release, players, URLs.
- `POST /games/prices/v3`: batched regional quotes and historical lows, with returned currencies/links.
- `GET /stats/most-popular/v1`: position and count; popularity = waitlisted + collected.
- `GET /deals/v2`: flat `steamCount`, `steamPerc`, `type`, `cut` and `price` filters, independently rechecked against metadata. `mature=false` is a **top-level query parameter**; the separate filter schema's boolean accepts only `true`, so no unsupported `filter.mature=false` is invented.

Sources: [API documentation](https://docs.isthereanydeal.com/), [public OpenAPI](https://github.com/IsThereAnyDeal/API/blob/master/dist/openapi.json), [most-popular definition](https://github.com/IsThereAnyDeal/API/blob/master/docs/routes/stats/most-popular.v1.yaml), [game-info schema](https://github.com/IsThereAnyDeal/API/blob/master/docs/routes/games/schemas/resp.games.info.yaml), [review filters](https://github.com/IsThereAnyDeal/API/blob/master/docs/defs/filters/obj.filters.reviews.yaml).

## Other repository branches checked

The other available branches were rechecked without switching this working branch:

- [`main@dc9726a`](https://github.com/dcizov/discordjs-starter/tree/dc9726a8aa039c31b5e5be33de738c8c95756710/src/commands)
- [`arena/752cdf1a-discordjs-starter@2ed0fec`](https://github.com/dcizov/discordjs-starter/tree/2ed0fecbe66a33228a10d1e2acbc7e5d7b6e8615/src/commands)

Both contain the original `guild`/`ping` starter commands and database scaffolding, not a richer ITAD/deals or music implementation to borrow. This work extends this branch's existing per-guild subscriptions, worker and transactional delivery outbox rather than adding a second posting pipeline or copying their older database/Docker layout.

## Verification boundary

Offline fixtures test endpoint versions/schema handling, header-only secrets, exact links, null data, popularity/review/type/maturity/region filtering, stable identities, posting caps after deduplication, current routing and permission guards. Browser tests exercise persistent channel/threshold configuration in demo; no real posts are claimed by those tests. Live prices/ratings/artwork/availability and actual Discord delivery still depend on your API credentials, regional offers, running worker and channel permissions.
