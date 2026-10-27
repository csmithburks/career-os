# Data model

## Networking CRM (Google Sheets)

| Tab | Purpose | Key columns |
|---|---|---|
| Contacts | One row per person | `contact_id`, `name`, `organization`, `relationship_status`, `last_conversation_date`, `last_discussed`, `next_action`, `next_action_due`, `cadence_days`, `notes`, `updated_at`, `updated_by` |
| Interactions | One row per chat, email thread or event | `interaction_id`, `contact_id`, `date`, `type`, `status` (Booked / Held / Needs confirmation), `prep_brief`, `summary` |
| Actions | Next steps with owners | `action_id`, `contact_id`, `owner` (me / Claude), `text`, `due`, `status` |
| Drafts | Every draft the agent writes | `draft_id`, `contact_id`, `purpose`, `status` (proposed / sent / removed (not sent)) |
| Candidates | People worth reaching out to | `name`, `org`, `why`, `warm_path` |
| To Check Out | Companies, programs and events to look into | `id`, `item`, `track`, `status` |
| Settings | Policy the agent follows | send policy, follow-up rule, weekly cold-draft cap, `excluded_from_import`, `relationship_status_values`, `stale_action_autoclose_days` |
| Log | One row per run | `run_at`, `changes`, `sources_used`, `issues` |
| School Mail / School Calendar | Written hourly by Apps Script (read-only to the agent) | `synced_at`, `direction`, `from`, `to`, `subject`, `date` / `start`, `end`, `title` |
| To Do Sync | Bridge to Microsoft To Do | `id`, `title`, `due`, `importance`, `note`, `done` |

## Dashboard datasets (JSON)

Rows are edited by stable `id`. See [`../dashboard/sample-data`](../dashboard/sample-data) for fictional examples.

```ts
timeline: { id, date: "YYYY-MM-DD" | "YYYY-MM", time?, title,
            kind: "deadline" | "event" | "milestone",
            track: "Tech" | "Defense tech" | "In-semester" | "Networking" | "General",
            source, done }
steps:    { id, priority: "high" | "med" | "low", text, due?, done }
issues:   { id, kind: "blocker" | "question", text, detail }
tracks:   { id, name, status, progress: 0-100, note }
```

## To Do sync file

```json
{ "list": "Recruiting", "generated": "YYYY-MM-DD",
  "items": [ { "id": "step-…", "title": "…", "due": "YYYY-MM-DD", "importance": "high|normal", "note": "…", "done": false } ] }
```
