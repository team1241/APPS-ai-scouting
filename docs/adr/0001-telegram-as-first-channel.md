# 0001: Telegram as the first channel

- Status: Accepted
- Date: 2026-10-31

## Context

Scouts must send data at Canadian events and at Worlds. Coverage at venues is not reliable. At Worlds, some students may not have a usable phone number, but most have a data plan. Budget is low.

## Decision

Use a Telegram bot as the only channel at first.

## Reasons

- It needs no local phone number. Students register before they travel.
- Telegram keeps unsent messages and sends them automatically when a connection returns.
- It works on weak networks.
- The Bot API is free and uses a simple HTTPS webhook.
- Bot commands, reply keyboards and inline buttons give enough structure.

## Options rejected

| Option | Reason |
|---|---|
| SMS (Twilio or Telnyx) | Students at Worlds may not have a usable number. US delivery needs A2P 10DLC or toll-free verification. Phones stop retrying after a few failures. |
| Discord bot | As far as we know, messages sent offline fail and need a manual resend. Reading free text needs an always-on gateway connection. |
| WhatsApp | Needs Meta business verification. Replies cost money after 1,000 per month. |
| PWA | iOS can clear its storage. More to build. |
| Native app (Expo) | Most reliable, but needs an Apple Developer account and more build time. Telegram covers most of the same needs. |

## Consequences

- Students need Telegram accounts. Check school policy on student messaging apps.
- Buttons and inline queries need a connection. Typed commands and reply keyboard buttons work offline.
- Telegram records server receive time, not compose time, so messages must name the match.
- A Discord webhook can post summaries to strategists without a Discord bot.
- Revisit a native app if events show gaps.
