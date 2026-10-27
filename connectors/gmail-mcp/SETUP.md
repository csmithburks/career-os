# Gmail MCP (both inboxes): local setup

Patched copy of dmorrill/gmail-mcp-multi (unmerged branch `feature/initial-implementation`), changed for this setup:

- **Read + drafts only.** Asks Google only for `gmail.readonly` and `gmail.compose`. There is no send, delete or label tool.
- **Windows sign-in fixed.** The original opened a blank window instead of the Google page. Sign-in also runs from a terminal (`node dist\auth.js <alias> <email>`), so it can't time out inside Claude.
- **Checks the account.** If you pick the wrong Google account in the browser, it refuses instead of saving it under the wrong name.
- **New tools:** `draft_email` (including replies in the same thread) and `read_thread`. `read_email` now returns readable text instead of raw encoded data.

## Set up
1. Finish the Google Cloud steps (Desktop app client, JSON downloaded to Downloads, both emails added as test users).
2. Double-click **Set up Gmail MCP.cmd**. It installs Node.js if needed, installs dependencies, copies the client file to `%USERPROFILE%\.gmail-mcp\oauth-keys.json`, signs in both accounts (`personal`, `school`) and adds the server to the Claude desktop app.
3. Fully quit and reopen Claude.

## Files it keeps
`%USERPROFILE%\.gmail-mcp\` holds your Google client file and one sign-in per account. Delete that folder to disconnect everything. You can also remove access at myaccount.google.com/permissions.

## Note
While the Google Cloud app is in "Testing", Google expires Gmail sign-ins after 7 days. To avoid re-signing weekly, open Google Auth Platform > Audience and click **Publish app**. You'll see an "unverified app" warning at sign-in, which is expected for a personal app.
