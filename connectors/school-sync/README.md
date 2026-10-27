# School sync (Google Apps Script)

My school's Google Workspace blocks third-party OAuth apps, so cloud agents can't read my school inbox or calendar directly. This script runs **inside** the school account, where it's allowed, and mirrors just what the agent needs into the CRM sheet every hour:

| Writes | Contents |
|---|---|
| `Wharton Mail` tab | Primary inbox + sent mail from the last 7 days: direction, date, from/to, subject, 300-char snippet, thread/message IDs. Newsletters and no-reply senders are skipped. |
| `Wharton Calendar` tab | Past 1 day + next 21 days: times, title, location, my RSVP, organizer, guests, a description snippet |
| `recruiting-sync.json` (Drive) | The agent's `To Do Sync` tab exported as JSON for [`todo-cli`](../../todo-cli). It never writes an empty list and skips the write when nothing changed. |

Design details:
- **One schedule, always:** `setup()` deletes any existing trigger before creating the hourly one, so re-running it never doubles up.
- **Isolated steps:** mail, calendar and To Do export each run in their own `try`, so one failure doesn't block the others. A script lock prevents overlapping runs.
- **Freshness stamp:** every row carries `synced_at`, and the agents treat data more than 6 hours old as "unknown" rather than "missing."
- **Formula-injection safe:** cell text starting with `=`, `+`, `-` or `@` is prefixed so it's stored as text.

**Setup:** script.google.com (signed in to the school account) → New project → paste `Code.gs` → fill in `<CRM_SHEET_ID>` and `<RECRUITING_SYNC_JSON_FILE_ID>` → run `setup` → approve permissions.
