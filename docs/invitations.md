# Team invitations

Manage invitations in a private chat with the bot. Your Telegram identity must already be enrolled as an admin.

- `/invite` creates a reusable scout link. `/invite Event scouts` adds a label.
- `/invites` lists the 20 newest invitation IDs, labels, join counts, and active/revoked status.
- `/revokeinvite <id>` disables a link immediately. People who already joined remain enrolled.

Share the returned link privately with the team. Each person opens it and taps Start. Telegram supplies their account ID and display name; the backend creates their scout membership. A link can enroll any number of different users and has no expiration. Repeated joins never duplicate a membership or change an existing role. Forwarded links also work until revoked.

Only SHA-256 hashes of random 192-bit invitation tokens are stored. The full link is returned only when created, so keep that Telegram message. Listing does not recover tokens. If the original response is lost, create a fresh link and revoke the old invitation by ID. Duplicate deliveries of the creation update do not create additional links.

Commands are handled before scouting intake and are not sent to the extractor. Group chats cannot create or redeem links. Queries use tenant context; links from another organization do not work. Database transactions serialize joins and revocation. The runtime permission migration grants only invitation select/insert/update and member/identity insert permissions in addition to existing runtime access. Admin enrollment remains an administrative operation.

Deployment requires both invitation migrations before rolling out the backend code. Apply them with a production owner connection; the runtime backend role cannot migrate. No additional environment variables are required. Test the dev bot before production.
