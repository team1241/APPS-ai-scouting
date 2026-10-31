# 0004: Self-contained messages and AI follow-up questions

- Status: Accepted
- Date: 2026-10-31

## Context

Messages queued offline arrive together when a phone reconnects. Telegram gives server receive time, not compose time. Dictation often gets numbers wrong.

## Decision

- Each message should name the match. The server fills in the event and the team.
- Each message is processed on its own. Order does not matter.
- When information is missing or unclear, the AI marks the entry `needs_review` and the bot asks the scout.

## Follow-up rules

- Send the question with `ForceReply`. Link the answer through `reply_to_message` and the stored `follow_up_message_id`.
- When a scout has many open questions, send one combined message.
- Check team and match numbers against the cached schedule before asking. Ask only when the schedule does not settle it.

## Options rejected

- **Context commands with ordered processing** (`/m 42`, then notes): needs strict per-scout ordering and stored state. Commands stay available as an input shortcut, but correctness does not depend on order.
- **Using receive time to find the match:** wrong after time offline.
