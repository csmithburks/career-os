# Architecture

## Components

| Component | Tech | Role | Writes to |
|---|---|---|---|
| Nightly agent | Claude scheduled task, cloud | The only writer: updates the CRM and dashboard, writes drafts, sends the digest | CRM, dashboard, Gmail drafts, To Do Sync tab |
| Morning agent | Claude scheduled task, cloud | Read-only agenda | One email to the owner |
| Networking CRM | Google Sheets | System of record for contacts, interactions, actions, drafts, settings and the log | — |
| School sync | Google Apps Script inside the school account, hourly | Gets around the OAuth block by writing 7 days of mail and 22 days of calendar to two sheet tabs | `School Mail`, `School Calendar` tabs |
| Recruiting dashboard | Claude Dashboard artifact + 4 JSON datasets | Visual timeline, next steps, blockers and track progress | — |
| todo-cli | Python 3, standard library only, Microsoft Graph | Idempotent sync of dashboard steps into Microsoft To Do; reports items I finished in To Do | To Do, `todo-sync-report.json` |
| gmail-mcp | TypeScript MCP server | V1 path to both inboxes from the desktop (now retired for the cloud runs) | Gmail drafts |

## Data flow

```mermaid
sequenceDiagram
  autonumber
  participant SS as School Apps Script (hourly)
  participant CRM as CRM Sheet
  participant N as Nightly agent (7:58 PM)
  participant D as Dashboard
  participant TD as todo-cli / To Do
  participant M as Morning agent (6:48 AM)
  participant Me as Me

  SS->>CRM: rewrite School Mail / School Calendar tabs
  N->>CRM: read all tabs + Log (last run time)
  N->>N: read Gmail, Calendar, Granola since last run
  N->>CRM: log chats, contacts, drafts, flags, prep briefs, Log row
  N->>D: update timeline / steps / issues / tracks (versioned)
  N->>CRM: rewrite To Do Sync tab
  CRM-->>TD: exported recruiting-sync.json
  TD->>TD: sync Recruiting list (no duplicates)
  TD-->>N: todo-sync-report.json (completed in To Do)
  N->>Me: digest (email + push)
  M->>CRM: read Actions / Interactions
  M->>Me: today's agenda email
```

## Why it's built this way

**Sheets as the database.** The CRM is readable and editable on a phone, auditable row by row, and every connector already speaks it. The cost is weak constraints, so the agent instructions enforce them instead: stable IDs, no reused IDs, allowed status values, check before append.

**Versioned writes on the dashboard.** Each dataset update carries the version it read (`if_version`). If something else changed the data in the meantime, the write fails instead of overwriting.

**Cloud-only runtime.** V1 depended on a local Gmail MCP server, so the system broke whenever my laptop was asleep. Moving the school-account access into an Apps Script that runs inside that account removed the laptop entirely.

**Failure handling.** Every run ends by naming any source it couldn't reach. Stale school data is labeled "unknown, may have gone from school mail" rather than treated as missing, so a sync outage can't produce wrong "you never replied" flags.
