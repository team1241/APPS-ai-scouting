# Scouting data API (v1)

The [OpenAPI contract](openapi.json) describes authenticated, read-only JSON routes
under `/v1` and is also served at `GET /v1/openapi.json` with key authentication. Use an organization API key as `Authorization: Bearer scout_…`.
The key selects the organization. Request parameters cannot select a tenant.
All responses, including errors, use `Cache-Control: private, no-store`.

## Read workflow

1. `GET /v1/organization` confirms which organization owns the key.
2. `GET /v1/teams/1241/events` discovers events with current extracted data for that team.
3. `GET /v1/events/{eventId}/teams/1241/observations` reads that team's current observations.
4. `GET /v1/events/{eventId}/observations` reads all teams at that event.
5. `GET /v1/events/{eventId}/specifications/{specificationVersion}?kind=<kind>` describes
   the questions of a returned record's publication: codes, labels, base requirement,
   answer constraints and rules. Records declare `kind` (`match`, `pit` or `general`).
   Versions are numbered per kind, so pass the record's kind. It defaults to `match`.
   Format 1 publications also return the original `fields` list.

```sh
# Supply API_BASE (HTTPS backend origin) and SCOUTING_API_KEY in your environment.
curl --fail-with-body -H "Authorization: Bearer $SCOUTING_API_KEY" \
  "$API_BASE/v1/teams/1241/events?limit=50"
curl --fail-with-body -H "Authorization: Bearer $SCOUTING_API_KEY" \
  "$API_BASE/v1/events/$EVENT_ID/teams/1241/observations?limit=50"
curl --fail-with-body -H "Authorization: Bearer $SCOUTING_API_KEY" \
  "$API_BASE/v1/events/$EVENT_ID/observations?limit=100"
```

List responses contain `{ "data": [...], "nextCursor": "..." }`. Continue with
`cursor=<nextCursor>` and the same route until `nextCursor` is null. `limit`
defaults to 50 and must be between 1 and 100. Unknown query parameters are rejected.
Cursors are opaque positions bound to the organization, event and team filter;
using one in a different scope returns 400. A cursor grants no access itself.

Ordering uses immutable logical-root UUIDs (event UUIDs for event discovery),
not update time. Follow-ups and explicit corrections keep the same public
observation ID and position; independent submissions remain separate. Pages
are live reads, not a point-in-time snapshot. During concurrent writes, new
records before the cursor may be missed, records can move between team filters,
and returned values can change. Start another traversal to refresh. No counts,
averages, deduplication, narrative summaries or AI analysis are computed.

## Freshness, completeness and privacy

Telegram receipt queues asynchronous extraction. Pending entries do not appear
as empty or completed observations. Once extraction supplies event and team
identity, the result appears even if required fields or match resolution are
missing, validation fails, or a scout has not finalized it. Until team identity
is available, a match or pit record is omitted from both team and event-wide reads.
A general note can have no team (`teamNumber: null`). It appears in event-wide reads only.
Pit records never have a match.

Each observation includes `event: { id, code, label }`. The label is the event
name; the code is the FIRST event code, falling back to the TBA event key, or
null when neither is configured. Event discovery entries include `eventCode`. Qualification labels in both
`match.label` and `values.match` use `Q<number>`: `1`, `q1`, `qm:1`, and
`qualification match 1` become `Q1`. Resolved qualifications use the schedule
match number. Playoff labels keep their stage identity. Label formatting does
not change `match.resolved` or validation status.

Each record includes a stable `id`, `updatedAt` (last successful extraction),
`specificationVersion`, derived `values`, `completeness`, and validation
mode/status. `match.resolved: false` and `match.id: null` explicitly indicate
unresolved match identity; the submitted match label can still be present.
`values` has one entry per question. Only current answers have a value. Unknown,
invalid and inactive answers are null. Explicit false, numeric 0 and `[]` are
answers. Choice answers are option codes.

`fields` gives the state of each question, so consumers can tell nulls apart:

| `state`      | Meaning                                                            |
| ------------ | ------------------------------------------------------------------ |
| `answered`   | Current answer in `values`.                                        |
| `unanswered` | Unknown, and known not to be required.                             |
| `missing`    | Unknown and required.                                              |
| `invalid`    | The answer did not pass its constraints. The scout is asked again. |
| `pending`    | Applicability is unknown until another answer is known.            |
| `inactive`   | Hidden by a rule. Any earlier answer is excluded from `values`.    |

`requirement` is `required`, `optional`, `unknown` or `not_applicable` (hidden).
Records recorded before conditional contracts are evaluated against their own
publication, which has no rules. `completeness.missing` lists the questions that
block completion. A record can have all required answers yet remain incomplete
because validation or an identity conflict still needs attention. Pit and general
records are not checked against the match schedule. A pit record is checked against
the event roster: `valid`, or `unknown_team` when the scout saved it anyway. Pit
records at events without a saved roster, and all general records, have
`not_applicable`.

Explicit correction sessions update the original logical record after their
first successful extraction, including incomplete corrections. Until then the
previous extraction remains visible. Superseded correction drafts are ignored.
Follow-ups retain the same ID. Corrections changing team identity remove the
old team's record. The latest successful extraction in a correction chain wins.
Older drafts without a recorded extraction time receive migration time as their
first export update; finalized records use their publication time.

Only specification-defined derived values are exported. Raw messages, scout and
account identifiers, extraction questions, per-message statements, inactive values,
revision history, internal provenance,
validation messages and conflict diagnostics are excluded. Extracted notes are
included and may contain incidental personal information; they are not anonymous.

## Errors and limits

Errors have the shape `{ "error": "..." }`:

- 400: invalid event/team, page size, cursor, or unsupported query parameter.
- 401: missing, invalid or revoked key.
- 404: event/specification absent from this organization (including another tenant's UUID).
- 429: per-key request limit exceeded; slow down and retry with backoff.
- 503: key verification, provider quota, configuration or data access unavailable;
  retry with backoff. Verification always fails closed.

A valid event with no matching observations returns an empty page. Empty event
discovery means no current extracted data, not proof that intake is complete.
Every request verifies the key and checks local revocation; there is no
verification cache. See [operations](../operations.md#organization-api-keys-21)
for provider usage and quota handling. No paid analytics service is required.

## Next.js server proxy

Use the [example route handler](nextjs-proxy.ts.example) in an integrating team's
own application. It keeps keys on the server, checks the signed-in user's live
organization authorization, and chooses a key from trusted server configuration.
The caller must not supply the upstream origin or key. This is an integration
example; the administration portal does not add a scouting-data browser.
