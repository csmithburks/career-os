# Nightly agent: recruiting + networking run

**Schedule:** daily, 7:58 PM ET · **Runs in:** the cloud (Claude scheduled task), no laptop needed
**Connectors:** Gmail, Google Calendar, Google Sheets, Google Drive, Granola
**Permissions:** reads everything; writes only to the CRM sheet, the dashboard and Gmail *drafts*

> Sanitized copy of the production instructions. IDs, links and personal details are replaced with `<PLACEHOLDERS>`.

---

## Guardrails (top of the prompt, on purpose)

- Never send any email, message or calendar invite. Never accept or decline invites. Never delete anything (rows, drafts, events).
- Everything outbound is a Gmail **draft** for the owner to review.
- This is the **only** task that edits the CRM and dashboard. A separate morning task only reads them.

## Context given to the agent

- Who I am and what I'm recruiting for: GTM/BD first, product second; AI and defense tech first, then general tech; preferred geography.
- What I'm **not** pursuing, so the agent doesn't generate follow-ups for dropped tracks.
- Networking goal: **4 one-on-one chats per week** (Mon–Sun). Group events, info sessions and club meetings don't count.

## Sources (only what changed since the last run)

| Source | How | Notes |
|---|---|---|
| Personal Gmail | Gmail connector | Sent, Primary inbox, drafts, booking confirmations. Skip promotions. |
| School mail + calendar | "School Mail" / "School Calendar" tabs in the CRM | Written hourly by a script inside the school account (it blocks third-party OAuth). Read-only. If `synced_at` is more than 6 hours old, say so once and treat missing items as "unknown," never "missing." |
| Google Calendar | Calendar connector | Past day + next 21 days. Events that show up in two places are counted once. |
| Granola | `list_meetings` → `get_meetings` | Notes with unlabeled speakers are "Needs confirmation," never assigned by guess. |

The last run time comes from the newest row in the CRM's `Log` tab.

## Part A: Networking CRM (`<CRM_SHEET_URL>`)

Follows the sheet's `Settings` tab: send policy, one follow-up after 7 business days and then stop, at most 10 cold drafts per week, an exclusion list, and allowed status values.

1. Read Contacts, Interactions, Actions, Drafts, Candidates, To Check Out, Settings, the school tabs and the latest Log rows.
2. **Log what changed.** Mark a chat **Held** only with a meeting note, a confirming email or the owner's say-so. Check for an existing row before adding one, and update it instead of duplicating. Stamp `updated_at` and `updated_by = "Claude"`.
3. **Reconcile drafts.** Mark a draft `sent` if it appears in either account's sent mail. If it's gone and wasn't sent, mark it `removed (not sent)` once.
4. **Flags:** overdue actions, contacts past their `cadence_days`, chats in the next 7 days, and chats that still need a debrief or thank-you.
5. **Prep briefs** for chats in the next 48 hours (on Fri/Sat, also Monday), written into the Interactions row: who they are, what we last discussed, and 2–3 questions tied to my goals.
6. **Drafts in my voice:** "Hey <name>!", 3–5 short lines, one clear ask, booking link `<BOOKING_LINK>`, "Best, Chris." Use only facts from my notes, my bio or public sources, and never claim a connection or conversation that isn't recorded.
7. **Sheet hygiene:** append with `append_values`; new IDs are the highest existing ID + 1 and never reused; stale "me"-owned admin items more than 14 days overdue are auto-closed; rows are never deleted.
8. Append one Log row summarizing the changes and the sources used.

## Part B: Recruiting dashboard (`<DASHBOARD_URL>`)

The dashboard reads four JSON datasets: `timeline`, `steps`, `issues` and `tracks` (see [`../docs/data-model.md`](../docs/data-model.md)). For each one that changed: read the current version → edit by stable `id` → upload → update the pointer with an `if_version` check, so a concurrent edit is never overwritten.

Rules: overdue items stay open until closed with evidence. Past events can be marked done. A question is added only for a decision only the owner can make. Steps are concrete next actions, highest value first. Tracks show rough progress plus this week's chat count vs. 4.

**To Do sync:** rewrite the CRM's `To Do Sync` tab with every step and deadline (stable IDs, due dates as text). A script exports it to `recruiting-sync.json`, and [`todo-cli`](../todo-cli) pushes it to Microsoft To Do. Items I complete in To Do come back through `todo-sync-report.json` and are marked done on the dashboard.

## Part C: Daily digest (emailed + push notification)

Under about 250 words, plain text, five sections with the most important item first:

1. Due in the next 48 hours (points to the prep brief)
2. Drafts waiting for review (up to 5: who and why)
3. Since yesterday: replies, bookings, new contacts
4. This week: chats held + booked vs. 4; if short, 2–3 specific people to reach out to (warm and school network first)
5. Questions only I can answer (up to 3)

The digest ends with any source that couldn't be reached. Its first sentence becomes the phone banner and email subject, so it has to be the single most important item.
