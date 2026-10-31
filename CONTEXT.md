# Domain context

## Terms

| Term                   | Meaning                                                                                          |
| ---------------------- | ------------------------------------------------------------------------------------------------ |
| **Organization**       | A tenant. One FRC team that uses the system and owns its scouting data.                          |
| **Member**             | A person in an organization. Role is `scout`, `strategist` or `admin`.                           |
| **Channel identity**   | A link from a Telegram user ID (later, other channels) to a member.                              |
| **Raw entry**          | One message exactly as received. Never edited.                                                   |
| **Observation**        | Structured data extracted from a raw entry about one FRC team. Kinds: `match`, `pit`, `general`. |
| **FRC team**           | A team being scouted. Do not confuse with an organization.                                       |
| **Event**              | An FRC competition, for example a district event or Worlds. Only one event is active at a time.  |
| **Match**              | One match at an event, with three red and three blue teams.                                      |
| **Follow-up question** | A message from the bot asking a scout for missing information about one or more raw entries.     |
| **Event mode**         | Server state that keeps the server and database awake during an event.                           |
| **Season schema**      | A versioned Zod schema for the game-specific metrics of one season.                              |

## Draft data model

### Reference data (shared, no tenant)

Cached from The Blue Alliance.

- `event`: `key`, `name`, `season`, `start_date`, `end_date`, `timezone`
- `frc_team`: `number`, `name`
- `match`: `key`, `event_key`, `comp_level`, `match_number`, `red_teams`, `blue_teams`, `scheduled_at`

### Tenant data

Every table has `organization_id`. Use Postgres row-level security on it.

- `organization`: `id`, `name`, `frc_team_number`
- `member`: `id`, `organization_id`, `name`, `role`
- `channel_identity`: `channel`, `external_id`, `member_id`
- `raw_entry`:
  - `id`, `organization_id`, `member_id`, `channel`
  - `external_update_id` (unique, for repeat deliveries)
  - `text`, `received_at`
  - `status`: `pending`, `processing`, `done`, `needs_review`, `failed`
  - `follow_up_message_id` (bot message that asked about this entry)
- `observation`:
  - `id`, `organization_id`, `raw_entry_id`, `member_id`
  - `kind`: `match`, `pit`, `general`
  - `event_key`, `match_key` (nullable), `frc_team_number`
  - `season_schema_version`, `data` (JSONB, checked with the season schema)
  - `notes`, `confidence`
  - `status`: `confirmed`, `corrected`
- `app_setting`: `organization_id`, `event_mode` (`auto`, `on`, `off`), `active_event_key`
- `share_grant` (later): `owner_organization_id`, `grantee_organization_id`, `event_key`

## Rules

- A raw entry is saved before any processing.
- Corrections create a new observation that points to the one it replaces. Observations are not edited in place.
- Game-specific metrics go in `data`. Fields common to all seasons are real columns.
- The 2027 season schema is defined after Kickoff in January 2027. Before then, test with a past season.
