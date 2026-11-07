# 2026 ONHAM1 public FIRST fixtures

Captured 2026-11-07 using authenticated read-only FIRST API requests. Event: STEMley Cup Championship, Hamilton, Ontario, held 2026-10-31. FIRST event listing type: OffSeasonWithAzureSync. No credentials or request headers are included.

- `teams.json`: `/v3.0/2026/teams?eventCode=ONHAM1&page=1`, six teams sampled from the original 28-team roster; counts adjusted for the sample.
- `qualification.json`: `/v3.0/2026/schedule/ONHAM1?tournamentLevel=Qualification`.
- `playoff.json`: `/v3.0/2026/schedule/ONHAM1?tournamentLevel=Playoff`.
- `results.json`: `/v3.0/2026/matches/ONHAM1`.

All four live requests returned HTTP 200. Qualification and results fixtures are trimmed to two records; the small playoff bracket is retained. FIRST timestamps are event-local wall times in America/Toronto. Playoff matches 1–13 contain rounds R1–R5; 14–16 are final 1, final 2, and final tiebreaker. FIRST identities retain their source numbering. Do not reinterpret these as TBA set/match numbers.

This offseason scope has no paired TBA fixture; paired regular-season/district-championship/Worlds coverage is documented in the parent fixtures README.
