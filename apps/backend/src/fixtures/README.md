# Reference provider fixtures

Public FIRST and TBA responses captured on 2026-11-07. No credentials or headers are stored. These are test data; production imports always call the providers.

## Event coverage

| FIRST scope | TBA key      | Purpose                                                |
| ----------- | ------------ | ------------------------------------------------------ |
| ONOSH       | 2026onosh    | Regular-season Ontario district event; main smoke test |
| ONCMP1      | 2026oncmp1   | Ontario Science division                               |
| ONCMP2      | 2026oncmp2   | Ontario Technology division; three played finals       |
| ONCMP       | 2026oncmp    | Ontario parent; finals-only schedule                   |
| ARCHIMEDES  | 2026arc      | Worlds division; provider event codes differ           |
| CMPTX       | 2026cmptx    | Worlds parent / Einstein bracket                       |
| ONHAM1      | not captured | Additional offseason regression required by issue #2   |

Each regular-season scope includes FIRST event details, roster, qualification schedule, playoff schedule and results, plus TBA event metadata and matches. `coverage.json` records the original FIRST counts (before trimming). Event type, division code, TBA parent/division keys and playoff type are retained. All endpoints returned HTTP 200. Parent ONCMP and CMPTX returned empty FIRST qualification/results lists even though their playoff schedules and TBA results exist; empty results must not become invented completion signals.

## Size and provenance

Rosters retain six real teams; their pagination counts are adjusted to make a self-contained sample. Qualification schedules retain two matches. FIRST results retain representative qualification/playoff/final records. TBA matches retain qualification matches 1–2 and the published playoffs; unused score breakdown/video fields are removed. Playoff schedules retain the full small bracket because every mapping is asserted, including unplayed tiebreaker slots. FIRST local timestamps are preserved; their timezone comes from event metadata. TBA timestamps use epoch seconds.

Source paths: FIRST `/v3.0/2026/events?eventCode=<code>`, `/teams?eventCode=<code>&page=1`, `/schedule/<code>?tournamentLevel=Qualification`, `/schedule/<code>?tournamentLevel=Playoff`, `/matches/<code>`; TBA `/api/v3/events/2026` (event metadata) and `/api/v3/event/<key>/matches`.

## Tested playoff mappings

For the captured 2026 eight-alliance double-elimination format (TBA playoff type 10), FIRST 1–13 map to TBA `sf<set>m1`; FIRST 14–16 map to `f1m1`–`f1m3`. Ontario's parent (TBA type 9, finals only) instead maps FIRST 1–3 to `f1m1`–`f1m3`. All played mapped matches have the same participating team sets in both source fixtures. Unplayed slots can be present only in FIRST.

The mapper is gated by season, FIRST event type and TBA playoff type. It does not generalize to unverified seasons/formats. Automatic event linkage uses TBA's declared `first_event_code`, season, compatible type and overlapping dates; manual linkage remains a fallback. Parent and division matches remain separate internal event scopes, even when their match numbers overlap.

## Live verification

On 2026-11-07 the live smoke imported each regular-season scope twice from FIRST, supplemented from TBA, and verified unchanged internal match IDs and no duplicate matches. Team/match totals: ONOSH 28/72; ONCMP1 50/116; ONCMP2 49/114; ONCMP 99/3; ARCHIMEDES 75/141; CMPTX 599/16.

Schedule-only live requests were also verified on 2026-11-07: FIRST/TBA qualification counts ONOSH 56/56 and ARCHIMEDES 125/125; finals-only ONCMP 3/2 (FIRST includes an unplayed tiebreaker); Einstein CMPTX 16/16. These requests did not send Telegram notifications.
