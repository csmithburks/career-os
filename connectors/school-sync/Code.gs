/**
 * School account -> Networking CRM sync (runs in Google's cloud, no laptop needed).
 *
 * Every hour:
 * 1. Copies your Wharton inbox/sent mail (last 7 days) and Wharton calendar
 *    (past 1 day, next 21 days) into the "Wharton Mail" and "Wharton Calendar"
 *    tabs of your Networking CRM sheet. Each run rewrites both tabs.
 * 2. Copies the "To Do Sync" tab (filled by the nightly Claude task) into
 *    recruiting-sync.json in your Career To Do CLI Drive folder, so
 *    ".\todo sync recruiting-sync.json" always has the latest list.
 *
 * SETUP (one time, about 3 minutes):
 * 1. Go to https://script.google.com signed in as your school Google account
 * 2. New project -> name it "Wharton CRM Sync" -> paste this whole file over the default code -> Save.
 * 3. In the function dropdown pick "setup" -> Run -> approve the permissions.
 *    That runs the sync once and schedules it every hour from then on.
 * Updating an existing project: paste over the old code, save, and run "setup" again
 * (it replaces the old hourly schedule, so you never end up with two).
 */

const SHEET_ID = '<CRM_SHEET_ID>';
const TZ = 'America/New_York';
const MAIL_DAYS = 7;
const MAX_THREADS = 150;
const CAL_PAST_DAYS = 1;
const CAL_FUTURE_DAYS = 21;
const SKIP_SENDERS = /no-?reply|newsletter|notifications?@|mailer-daemon|digest|marketing/i;
const TODO_TAB = 'To Do Sync';
const TODO_FILE_ID = '<RECRUITING_SYNC_JSON_FILE_ID>'; // Career To Do CLI/recruiting-sync.json

function setup() {
  ScriptApp.getProjectTriggers()
    .filter(t => t.getHandlerFunction() === 'syncWharton')
    .forEach(t => ScriptApp.deleteTrigger(t));
  ScriptApp.newTrigger('syncWharton').timeBased().everyHours(1).create();
  syncWharton();
}

function syncWharton() {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(30000)) return;
  try {
    const syncedAt = fmt_(new Date());
    const ss = SpreadsheetApp.openById(SHEET_ID);
    // Each step runs on its own, so one failing never blocks the others.
    [() => syncMail_(ss, syncedAt), () => syncCalendar_(ss, syncedAt), () => exportTodoSync_(ss)]
      .forEach(step => { try { step(); } catch (e) { console.error(e); } });
  } finally {
    lock.releaseLock();
  }
}

// To Do Sync tab -> recruiting-sync.json. Columns A:F = id, title, due, importance, note, done;
// I1 = generated date. Never writes an empty list, and skips the write when nothing changed.
function exportTodoSync_(ss) {
  const sheet = ss.getSheetByName(TODO_TAB);
  if (!sheet || sheet.getLastRow() < 2) return;
  const items = sheet.getRange(2, 1, sheet.getLastRow() - 1, 6).getValues()
    .filter(r => String(r[0]).trim())
    .map(r => {
      const item = { id: String(r[0]).trim(), title: String(r[1]), due: dateText_(r[2]) || null,
                     importance: String(r[3]).toLowerCase() === 'high' ? 'high' : 'normal' };
      if (String(r[4]).trim()) item.note = String(r[4]);
      item.done = r[5] === true || String(r[5]).toUpperCase() === 'TRUE';
      return item;
    });
  if (!items.length) return;
  const generated = dateText_(sheet.getRange('I1').getValue()) || Utilities.formatDate(new Date(), TZ, 'yyyy-MM-dd');
  const json = JSON.stringify({ list: 'Recruiting', generated: generated, items: items }, null, 2);
  const file = DriveApp.getFileById(TODO_FILE_ID);
  if (file.getBlob().getDataAsString() === json) return;
  file.setContent(json);
}

function dateText_(v) {
  if (v instanceof Date) return Utilities.formatDate(v, TZ, 'yyyy-MM-dd');
  return String(v == null ? '' : v).trim();
}

function syncMail_(ss, syncedAt) {
  const me = Session.getActiveUser().getEmail().toLowerCase();
  const cutoff = new Date(Date.now() - MAIL_DAYS * 86400000);
  const seen = {};
  const rows = [];
  const searches = [
    ['received', 'in:inbox category:primary newer_than:' + MAIL_DAYS + 'd'],
    ['sent', 'in:sent newer_than:' + MAIL_DAYS + 'd'],
  ];
  searches.forEach(([direction, query]) => {
    GmailApp.search(query, 0, MAX_THREADS).forEach(thread => {
      thread.getMessages().forEach(m => {
        const id = m.getId();
        if (seen[id] || m.getDate() < cutoff) return;
        const from = m.getFrom();
        const fromMe = from.toLowerCase().indexOf(me) !== -1;
        if (direction === 'received' && (fromMe || SKIP_SENDERS.test(from))) return;
        if (direction === 'sent' && !fromMe) return;
        seen[id] = true;
        rows.push([
          syncedAt, direction, fmt_(m.getDate()), from, m.getTo(), m.getSubject(),
          m.getPlainBody().replace(/\s+/g, ' ').trim().slice(0, 300),
          thread.getId(), id,
        ]);
      });
    });
  });
  rows.sort((a, b) => (a[2] < b[2] ? 1 : -1));
  writeTab_(ss, 'Wharton Mail',
    ['synced_at', 'direction', 'date', 'from', 'to', 'subject', 'snippet', 'thread_id', 'message_id'],
    rows, syncedAt);
}

function syncCalendar_(ss, syncedAt) {
  const start = new Date(Date.now() - CAL_PAST_DAYS * 86400000);
  const end = new Date(Date.now() + CAL_FUTURE_DAYS * 86400000);
  const rows = CalendarApp.getDefaultCalendar().getEvents(start, end).map(e => [
    syncedAt,
    fmt_(e.getStartTime()),
    fmt_(e.getEndTime()),
    e.isAllDayEvent() ? 'yes' : 'no',
    e.getTitle(),
    e.getLocation(),
    String(e.getMyStatus()),
    (e.getCreators() || [])[0] || '',
    e.getGuestList().slice(0, 15).map(g => g.getEmail()).join(', '),
    e.getId(),
    (e.getDescription() || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 300),
  ]);
  writeTab_(ss, 'Wharton Calendar',
    ['synced_at', 'start', 'end', 'all_day', 'title', 'location', 'my_status', 'organizer', 'guests', 'event_id', 'description'],
    rows, syncedAt);
}

function writeTab_(ss, name, header, rows, syncedAt) {
  const sheet = ss.getSheetByName(name) || ss.insertSheet(name);
  if (!rows.length) {
    const empty = header.map(() => '');
    empty[0] = syncedAt;
    empty[1] = '(nothing in window)';
    rows = [empty];
  }
  const data = [header].concat(rows).map(r => r.map(safe_));
  sheet.clearContents();
  sheet.getRange(1, 1, data.length, header.length).setValues(data);
  sheet.setFrozenRows(1);
}

// Stop cell text like "=..." from being treated as a formula.
function safe_(v) {
  const s = v == null ? '' : String(v);
  return /^[=+\-@]/.test(s) ? "'" + s : s;
}

function fmt_(d) {
  return Utilities.formatDate(d, TZ, 'yyyy-MM-dd HH:mm');
}