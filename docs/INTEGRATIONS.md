# Integrations and source setup

## News source matrix

| Starter / adapter | What Orbit actually uses                          | Setup                                                               |
| ----------------- | ------------------------------------------------- | ------------------------------------------------------------------- |
| Steam             | Official `ISteamNews/GetNewsForApp/v2` API        | Set a public Steam application ID (e.g. 570); no fabricated RSS URL |
| RSS / Atom        | HTTPS XML feeds                                   | Supply a verified publisher-supported URL                           |
| Blizzard          | Administrator-supplied RSS/Atom or signed webhook | Setup required; no universal news URL/API is assumed                |
| Wowhead           | Administrator-supplied RSS/Atom or signed webhook | Setup required; HTML scraping is disabled                           |
| Mojang            | Administrator-supplied RSS/Atom or signed webhook | Setup required; verify the publisher’s current supported endpoint   |
| Incoming webhook  | Authenticated JSON events                         | Generate a source-specific signing secret                           |

The named Blizzard/Wowhead/Mojang starters are routing/configuration templates, **not invented feed implementations**. An available publisher feed may differ by product, locale, or licensing. Verify it directly with the publisher. You can create any number of verified RSS/Atom sources or use an authorized integration to push updates. An API adapter in this release means the supported Steam app-news adapter, not unrestricted arbitrary-URL JSON execution.

RSS/Atom fetching requires HTTPS, a public DNS resolution, the standard HTTPS port, a suitable XML content type, and a response at most 1 MiB. The validated IP is pinned to the network socket. Every redirect is separately validated, up to three redirects. XML DTDs/entities are rejected. Private networks, loopback, cloud metadata, reserved networks, URL credentials, and internal hostnames are blocked. Do not place secrets in a feed URL; source URLs are visible to server administrators.

### Useful dashboard flow

1. Create a source and choose a destination text channel.
2. Configure an official Steam app ID, verified RSS/Atom URL, or webhook adapter.
3. Add optional tags and keyword filters.
4. Choose polling interval, summary, accent color, and optional role.
5. **Test source** fetches/parses only. It does not publish to Discord.
6. **Send test message** explicitly publishes a test to the selected channel in live mode.
7. Review source health and full delivery history. Missing permissions/upstream errors are retained.
8. Add routing rules for additional destinations or filtered paths.

Use the source list's **Needs setup** filter to find unconfigured starters. Module setup guidance distinguishes configured settings from verified delivery. A source may use its own direct destination or enabled routing rules; both feed the same deduplicated outbox. A configured source with no check yet is “Awaiting check”, not falsely “Healthy”.

In demo mode, both test actions are simulated and clearly labeled. No publisher is contacted.

## Incoming webhooks

Create a source with adapter **Signed incoming webhook**, save it, then choose **Webhook credentials**. The secret is shown once. Generating it again invalidates the old secret. Deleting the source deletes its credential via a foreign-key cascade.

**POST** `/api/webhooks/{sourceId}`

Headers:

```text
Content-Type: application/json
X-Orbit-Timestamp: <current Unix milliseconds or seconds>
X-Orbit-Signature: sha256=<HMAC-SHA256 hex of timestamp + "." + exact UTF-8 body>
```

Body, maximum 64 KiB:

```json
{
  "id": "publisher-event-unique-123",
  "title": "A community update",
  "url": "https://publisher.example/news/123",
  "summary": "A short, safe summary.",
  "tags": ["Community"],
  "publishedAt": "2026-10-24T10:00:00Z"
}
```

`publishedAt`, `summary`, and `tags` are optional. The endpoint accepts only the supported fields. Use a stable event ID; retries with the same source/event/destination are deduplicated. Timestamps outside a five-minute window are rejected. A disabled source/module does not publish. Demo mode rejects all incoming live webhooks with HTTP 409.

Example sender (run from your own integration, **never** browser code):

```js
import { createHmac } from "node:crypto";
const body = JSON.stringify({
  id: "announcement-123",
  title: "A new chapter",
  url: "https://your-publisher.example/announcements/123",
  summary: "A little good news for your community.",
  tags: ["Community"],
});
const timestamp = String(Date.now());
const signature = createHmac("sha256", process.env.ORBIT_WEBHOOK_SECRET)
  .update(`${timestamp}.${body}`)
  .digest("hex");
const response = await fetch(process.env.ORBIT_WEBHOOK_URL, {
  method: "POST",
  body,
  headers: {
    "Content-Type": "application/json",
    "X-Orbit-Timestamp": timestamp,
    "X-Orbit-Signature": `sha256=${signature}`,
  },
});
if (!response.ok) throw new Error(`Webhook rejected: ${response.status}`);
```

A 202 response reports accepted new destination reservations. `accepted: 0` can mean a duplicate, disabled module/source, a filter mismatch, or no valid destination. It is not a guarantee that a Discord delivery has completed; inspect delivery history.

## IsThereAnyDeal

See the [complete deals setup/command guide](DEALS.md) for rich cards, automatic
posting, the actual public API schema and evidence-based popularity filters.
Set `ITAD_API_KEY` **server-side on bot, web and worker**. Calls use the documented
`ITAD-API-Key` header, not query-string credentials. Follow the provider's
application-access rules, attribution, quota and terms.

Implemented public adapters: `GET /games/search/v1`, `GET /games/info/v2`,
`POST /games/prices/v3`, `GET /stats/most-popular/v1`, and `GET /deals/v2`.
Game artwork/ratings/players/links come from those responses; no internal
endpoints or scraping are used, and affiliate links are retained unchanged.

A general feed requires top-500 ITAD popularity membership **and** at least
10,000 Steam reviews / 70% positive by default. Thresholds/player floors are
configurable; missing evidence, mature/unknown games, DLC/packages and expired
or wrong-currency prices are excluded. There is no arbitrary-discount fallback.
Explicit single-game watches are deliberate choices rather than discovery.

Managers can use `/deals feed channel:#game-deals` or **Game deals → Set up deal
alerts**, choose a destination and leave game search unselected. The existing
worker/outbox delivers actual rich cards with a cap on **new** posts per check.
`/deals now` is an ephemeral preview, not a channel delivery. Save/preview success
is not a claim a scheduled post completed; inspect delivery history.

Caches, bounded concurrency, provider Retry-After handling, stable offer IDs,
fresh routing/quality checks and delivery nonces protect quota and duplicate
posts. No currency conversion occurs; final prices/terms must be checked at the
store. Demo persists configuration but never calls ITAD or posts to Discord.

## Notification roles and Discord permissions

Destinations require **View Channel**, **Send Messages**, and **Embed Links**. Optional reaction cleanup additionally needs **Manage Messages**, which moderation purges also require. Roles must belong to the configured server. `@everyone`, integration roles, and automatic user/mass mentions are not permitted.

The supplied invitation does not grant **Mention Everyone**. For notifications, make the explicitly selected notification role mentionable, or deliberately grant the appropriate permission after reviewing the security implications. `allowed_mentions` still limits each delivery to the configured role; arbitrary mentions in publisher text cannot expand it.

A channel/role removed in Discord may make a configuration invalid. Fix the destination or bot permissions in Discord, wait for metadata sync, and test again. An exhausted delivery stays in history with its error; it is not silently removed or infinitely retried.
