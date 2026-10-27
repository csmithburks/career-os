#!/usr/bin/env python3
"""career-todo: a small command-line client for Microsoft To Do.

Talks to Microsoft To Do through the Microsoft Graph API. Standard library only
(Python 3.9+), so it runs anywhere Python does.

  python todo.py login                 sign in (device code: you approve in your browser)
  python todo.py lists                 show your To Do lists
  python todo.py tasks --list Recruiting
  python todo.py add "Email Abby" --due 2026-10-21 --importance high
  python todo.py done "Email Abby"
  python todo.py sync recruiting-sync.json        push the Career Advisor dashboard into To Do
  python todo.py export --list Recruiting         tasks as JSON (for Claude to read)

Your sign-in is kept in ~/.career-todo/ (on Windows: C:\\Users\\<you>\\.career-todo\\).
Run "python todo.py logout" to remove it.
"""
from __future__ import annotations

import argparse
import json
import os
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from datetime import date, datetime, timezone
from pathlib import Path

VERSION = "0.1.0"

# Microsoft's own public client for command-line Graph access ("Microsoft Graph
# Command Line Tools"). Override with --client-id or CAREER_TODO_CLIENT_ID if your
# organization blocks it; see README for registering your own (free, 5 minutes).
DEFAULT_CLIENT_ID = "14d82eec-204b-4c2f-b7e8-296a70dab67e"
SCOPES = "Tasks.ReadWrite User.Read offline_access"

LOGIN_BASE = os.environ.get("CAREER_TODO_LOGIN_BASE", "https://login.microsoftonline.com").rstrip("/")
GRAPH_BASE = os.environ.get("CAREER_TODO_GRAPH_BASE", "https://graph.microsoft.com/v1.0").rstrip("/")
HOME = Path(os.environ.get("CAREER_TODO_HOME", Path.home() / ".career-todo"))
TOKEN_FILE = HOME / "token.json"
STATE_FILE = HOME / "sync-state.json"

APP_NAME = "Career Dashboard"  # tags tasks this tool created from the dashboard
DEFAULT_LIST = "Recruiting"


class CliError(Exception):
    """A problem to show the user as one plain line, with no traceback."""


# --------------------------------------------------------------------------- storage

def _read_json(path: Path, default):
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except FileNotFoundError:
        return default
    except json.JSONDecodeError as e:
        raise CliError(f"{path} is not valid JSON ({e}). Fix or delete it and try again.")


def _write_json(path: Path, data) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(path.suffix + ".tmp")
    tmp.write_text(json.dumps(data, indent=2, ensure_ascii=False), encoding="utf-8")
    try:
        os.chmod(tmp, 0o600)
    except OSError:
        pass
    os.replace(tmp, path)


# --------------------------------------------------------------------------- http

def _http(method: str, url: str, *, data=None, form=None, headers=None, retries: int = 4):
    body = None
    hdrs = {"Accept": "application/json", "User-Agent": f"career-todo/{VERSION}"}
    if headers:
        hdrs.update(headers)
    if form is not None:
        body = urllib.parse.urlencode(form).encode()
        hdrs["Content-Type"] = "application/x-www-form-urlencoded"
    elif data is not None:
        body = json.dumps(data).encode()
        hdrs["Content-Type"] = "application/json"
    for attempt in range(retries + 1):
        req = urllib.request.Request(url, data=body, method=method, headers=hdrs)
        try:
            with urllib.request.urlopen(req, timeout=60) as resp:
                raw = resp.read()
                return resp.status, (json.loads(raw) if raw else {})
        except urllib.error.HTTPError as e:
            raw = e.read()
            try:
                payload = json.loads(raw) if raw else {}
            except json.JSONDecodeError:
                payload = {"raw": raw.decode(errors="replace")[:500]}
            if e.code in (429, 503, 504) and attempt < retries:
                wait = e.headers.get("Retry-After")
                time.sleep(min(float(wait) if wait and wait.replace(".", "", 1).isdigit() else 2 ** attempt, 30))
                continue
            return e.code, payload
        except urllib.error.URLError as e:
            if attempt < retries:
                time.sleep(2 ** attempt)
                continue
            raise CliError(f"Couldn't reach {urllib.parse.urlsplit(url).netloc}: {e.reason}. Check your internet connection.")
    raise CliError("Gave up after several retries.")


def _graph_error(status: int, payload) -> str:
    err = payload.get("error") if isinstance(payload, dict) else None
    if isinstance(err, dict):
        return f"Microsoft To Do answered {status}: {err.get('message') or err.get('code')}"
    return f"Microsoft To Do answered {status}."


# --------------------------------------------------------------------------- auth

class Auth:
    def __init__(self, client_id: str | None = None, tenant: str | None = None):
        saved = _read_json(TOKEN_FILE, {})
        self.client_id = client_id or os.environ.get("CAREER_TODO_CLIENT_ID") or saved.get("client_id") or DEFAULT_CLIENT_ID
        self.tenant = tenant or saved.get("tenant") or "common"
        self.saved = saved

    def _token_url(self) -> str:
        return f"{LOGIN_BASE}/{self.tenant}/oauth2/v2.0/token"

    def _store(self, tok: dict) -> None:
        data = {
            "client_id": self.client_id,
            "tenant": self.tenant,
            "access_token": tok["access_token"],
            "refresh_token": tok.get("refresh_token") or self.saved.get("refresh_token"),
            "expires_at": int(time.time()) + int(tok.get("expires_in", 3600)) - 120,
            "account": self.saved.get("account"),
        }
        self.saved = data
        _write_json(TOKEN_FILE, data)

    def login(self) -> None:
        status, dc = _http("POST", f"{LOGIN_BASE}/{self.tenant}/oauth2/v2.0/devicecode",
                           form={"client_id": self.client_id, "scope": SCOPES})
        if status != 200:
            raise CliError(f"Sign-in couldn't start: {dc.get('error_description') or dc.get('error') or status}")
        print()
        print(dc.get("message") or f"Open {dc['verification_uri']} and enter the code {dc['user_code']}")
        print("Waiting for you to finish signing in in your browser...")
        interval = int(dc.get("interval", 5))
        deadline = time.time() + int(dc.get("expires_in", 900))
        while time.time() < deadline:
            time.sleep(interval)
            status, tok = _http("POST", self._token_url(), form={
                "grant_type": "urn:ietf:params:oauth:grant-type:device_code",
                "client_id": self.client_id,
                "device_code": dc["device_code"],
            })
            if status == 200:
                self._store(tok)
                return
            err = tok.get("error")
            if err == "authorization_pending":
                continue
            if err == "slow_down":
                interval += 5
                continue
            raise CliError(f"Sign-in failed: {tok.get('error_description') or err}")
        raise CliError("Sign-in timed out. Run login again.")

    def token(self) -> str:
        if not self.saved.get("access_token"):
            raise CliError("You're not signed in. Run: python todo.py login")
        if time.time() < self.saved.get("expires_at", 0):
            return self.saved["access_token"]
        if not self.saved.get("refresh_token"):
            raise CliError("Your sign-in expired. Run: python todo.py login")
        status, tok = _http("POST", self._token_url(), form={
            "grant_type": "refresh_token",
            "client_id": self.client_id,
            "refresh_token": self.saved["refresh_token"],
            "scope": SCOPES,
        })
        if status != 200:
            raise CliError("Your sign-in expired or was revoked. Run: python todo.py login")
        self._store(tok)
        return self.saved["access_token"]


# --------------------------------------------------------------------------- graph

class Graph:
    def __init__(self, auth: Auth):
        self.auth = auth

    def call(self, method: str, path: str, data=None, *, ok=(200, 201, 204)):
        url = path if path.startswith("http") else GRAPH_BASE + path
        for attempt in range(2):
            status, payload = _http(method, url, data=data, headers={"Authorization": f"Bearer {self.auth.token()}"})
            if status == 401 and attempt == 0:
                self.auth.saved["expires_at"] = 0  # force a refresh, then retry once
                continue
            if status not in ok:
                raise CliError(_graph_error(status, payload))
            return payload
        raise CliError("Microsoft To Do refused the sign-in. Run: python todo.py login")

    def paged(self, path: str) -> list:
        out, nxt = [], path
        while nxt:
            page = self.call("GET", nxt)
            out.extend(page.get("value", []))
            nxt = page.get("@odata.nextLink")
        return out

    def me(self) -> dict:
        return self.call("GET", "/me?$select=displayName,userPrincipalName,mail")

    def lists(self) -> list:
        return self.paged("/me/todo/lists")

    def find_list(self, name: str, create: bool = False) -> dict:
        lists = self.lists()
        for lst in lists:
            if lst.get("displayName", "").casefold() == name.casefold():
                return lst
        if create:
            return self.call("POST", "/me/todo/lists", {"displayName": name})
        names = ", ".join(sorted(l.get("displayName", "") for l in lists)) or "none"
        raise CliError(f'No To Do list named "{name}". Your lists: {names}. (Add --create to make it.)')

    def tasks(self, list_id: str, include_done: bool = False) -> list:
        q = "/me/todo/lists/{}/tasks?$expand=linkedResources&$top=100".format(urllib.parse.quote(list_id, safe=""))
        if not include_done:
            q += "&$filter=" + urllib.parse.quote("status ne 'completed'")
        return self.paged(q)

    def create_task(self, list_id: str, body: dict) -> dict:
        return self.call("POST", f"/me/todo/lists/{urllib.parse.quote(list_id, safe='')}/tasks", body)

    def update_task(self, list_id: str, task_id: str, body: dict) -> dict:
        return self.call("PATCH", f"/me/todo/lists/{urllib.parse.quote(list_id, safe='')}/tasks/{urllib.parse.quote(task_id, safe='')}", body)


# --------------------------------------------------------------------------- helpers

def _parse_due(s: str | None) -> str | None:
    if not s:
        return None
    s = s.strip()
    if s.lower() in ("today", "tomorrow"):
        d = date.today()
        if s.lower() == "tomorrow":
            d = date.fromordinal(d.toordinal() + 1)
        return d.isoformat()
    try:
        return date.fromisoformat(s[:10]).isoformat()
    except ValueError:
        if len(s) == 7:  # YYYY-MM: treat as the 1st, so it's visible early
            try:
                return date.fromisoformat(s + "-01").isoformat()
            except ValueError:
                pass
        raise CliError(f'"{s}" is not a date. Use YYYY-MM-DD, "today" or "tomorrow".')


def _due_body(day: str | None):
    # To Do keeps due dates as whole days; midnight UTC round-trips exactly.
    return {"dateTime": f"{day}T00:00:00.0000000", "timeZone": "UTC"} if day else None


def _task_due(task: dict) -> str | None:
    d = task.get("dueDateTime") or {}
    return (d.get("dateTime") or "")[:10] or None


def _external_id(task: dict) -> str | None:
    for lr in task.get("linkedResources") or []:
        if lr.get("applicationName") == APP_NAME and lr.get("externalId"):
            return lr["externalId"]
    return None


def _fmt_task(t: dict) -> str:
    mark = "[x]" if t.get("status") == "completed" else "[ ]"
    due = _task_due(t)
    imp = " !" if t.get("importance") == "high" else ""
    return f"{mark}{imp} {t.get('title', '')}" + (f"  (due {due})" if due else "")


def _pick_task(tasks: list, query: str) -> dict:
    exact = [t for t in tasks if t.get("id") == query or t.get("title", "").casefold() == query.casefold()]
    if len(exact) == 1:
        return exact[0]
    hits = [t for t in tasks if query.casefold() in t.get("title", "").casefold()]
    if len(hits) == 1:
        return hits[0]
    if not hits:
        raise CliError(f'No open task matches "{query}".')
    titles = "\n  ".join(t.get("title", "") for t in hits[:10])
    raise CliError(f'"{query}" matches {len(hits)} tasks; be more specific:\n  {titles}')


# --------------------------------------------------------------------------- sync

def load_sync_file(path: Path) -> dict:
    data = _read_json(path, None)
    if data is None:
        raise CliError(f"Can't find {path}.")
    items = data.get("items") if isinstance(data, dict) else data
    if not isinstance(items, list):
        raise CliError(f'{path} should hold {{"list": "...", "items": [...]}}.')
    clean = []
    for i, it in enumerate(items):
        if not isinstance(it, dict) or not it.get("id") or not it.get("title"):
            raise CliError(f"Item {i + 1} in {path} needs an id and a title.")
        imp = it.get("importance", "normal")
        if imp not in ("low", "normal", "high"):
            raise CliError(f'Item "{it["id"]}" has importance "{imp}"; use low, normal or high.')
        clean.append({
            "id": str(it["id"]),
            "title": str(it["title"]).strip(),
            "due": _parse_due(it.get("due")),
            "importance": imp,
            "note": (it.get("note") or "").strip(),
            "done": bool(it.get("done", False)),
        })
    ids = [c["id"] for c in clean]
    if len(ids) != len(set(ids)):
        raise CliError(f"{path} has two items with the same id.")
    return {"list": (data.get("list") if isinstance(data, dict) else None) or DEFAULT_LIST, "items": clean}


def plan_sync(items: list, tasks: list, state: dict) -> dict:
    """Work out what to change. Pure: no network, so it can be tested."""
    by_ext = {}
    for t in tasks:
        ext = _external_id(t)
        if ext:
            by_ext[ext] = t
    by_id = {t["id"]: t for t in tasks if t.get("id")}
    for ext, tid in state.items():  # fall back to remembered task ids
        if ext not in by_ext and tid in by_id:
            by_ext[ext] = by_id[tid]

    plan = {"create": [], "update": [], "complete": [], "completed_in_todo": [], "unchanged": []}
    for it in items:
        t = by_ext.get(it["id"])
        if t is None:
            if not it["done"]:
                plan["create"].append(it)
            continue
        if t.get("status") == "completed":
            if not it["done"]:
                plan["completed_in_todo"].append({"id": it["id"], "title": it["title"]})
            continue
        if it["done"]:
            plan["complete"].append((it, t))
            continue
        changes = {}
        if t.get("title") != it["title"]:
            changes["title"] = it["title"]
        if _task_due(t) != it["due"]:
            changes["dueDateTime"] = _due_body(it["due"])
        if t.get("importance", "normal") != it["importance"]:
            changes["importance"] = it["importance"]
        if changes:
            plan["update"].append((it, t, changes))
        else:
            plan["unchanged"].append(it)
    return plan


def _new_task_body(it: dict) -> dict:
    body = {
        "title": it["title"],
        "importance": it["importance"],
        "linkedResources": [{
            "applicationName": APP_NAME,
            "displayName": "Career Advisor dashboard",
            "externalId": it["id"],
            "webUrl": "https://claude.ai",
        }],
    }
    if it["due"]:
        body["dueDateTime"] = _due_body(it["due"])
    if it["note"]:
        body["body"] = {"content": it["note"], "contentType": "text"}
    return body


# --------------------------------------------------------------------------- commands

def cmd_login(a):
    auth = Auth(a.client_id, a.tenant)
    auth.login()
    me = Graph(auth).me()
    auth.saved["account"] = me.get("userPrincipalName") or me.get("mail")
    _write_json(TOKEN_FILE, auth.saved)
    print(f"Signed in as {me.get('displayName')} ({auth.saved['account']}).")


def cmd_logout(a):
    removed = False
    for p in (TOKEN_FILE, STATE_FILE):
        if p.exists():
            p.unlink()
            removed = True
    print("Signed out; saved sign-in removed." if removed else "You weren't signed in.")


def cmd_whoami(a):
    me = Graph(Auth()).me()
    print(f"{me.get('displayName')} ({me.get('userPrincipalName') or me.get('mail')})")


def cmd_lists(a):
    for lst in Graph(Auth()).lists():
        print(lst.get("displayName"))


def cmd_tasks(a):
    g = Graph(Auth())
    lst = g.find_list(a.list)
    tasks = g.tasks(lst["id"], include_done=a.all)
    tasks.sort(key=lambda t: (t.get("status") == "completed", _task_due(t) or "9999", t.get("title", "")))
    if not tasks:
        print(f'No {"" if a.all else "open "}tasks in "{lst["displayName"]}".')
    for t in tasks:
        print(_fmt_task(t))


def cmd_add(a):
    g = Graph(Auth())
    lst = g.find_list(a.list, create=a.create)
    body = {"title": a.title, "importance": a.importance}
    due = _parse_due(a.due)
    if due:
        body["dueDateTime"] = _due_body(due)
    if a.note:
        body["body"] = {"content": a.note, "contentType": "text"}
    t = g.create_task(lst["id"], body)
    print(f'Added to "{lst["displayName"]}": {_fmt_task(t)}')


def cmd_done(a):
    g = Graph(Auth())
    lst = g.find_list(a.list)
    t = _pick_task(g.tasks(lst["id"]), a.query)
    g.update_task(lst["id"], t["id"], {"status": "completed"})
    print(f"Completed: {t.get('title')}")


def cmd_export(a):
    g = Graph(Auth())
    lst = g.find_list(a.list)
    out = []
    for t in g.tasks(lst["id"], include_done=True):
        out.append({
            "title": t.get("title"),
            "status": t.get("status"),
            "due": _task_due(t),
            "importance": t.get("importance"),
            "dashboard_id": _external_id(t),
            "completed": ((t.get("completedDateTime") or {}).get("dateTime") or "")[:10] or None,
        })
    text = json.dumps({"list": lst["displayName"], "exported": datetime.now(timezone.utc).isoformat(timespec="seconds"), "tasks": out}, indent=2, ensure_ascii=False)
    if a.out:
        Path(a.out).write_text(text + "\n", encoding="utf-8")
        print(f"Wrote {len(out)} tasks to {a.out}")
    else:
        print(text)


def cmd_sync(a):
    spec = load_sync_file(Path(a.file))
    list_name = a.list or spec["list"]
    g = Graph(Auth())
    lst = g.find_list(list_name, create=True)
    state_all = _read_json(STATE_FILE, {})
    state = state_all.get(lst["id"], {})
    plan = plan_sync(spec["items"], g.tasks(lst["id"], include_done=True), state)

    verb = "Would" if a.dry_run else ""
    def say(msg):
        print(f"  {verb + ' ' if verb else ''}{msg}")

    print(f'Syncing {len(spec["items"])} dashboard items into "{lst["displayName"]}"' + (" (dry run, nothing changed)" if a.dry_run else ""))
    for it in plan["create"]:
        say(f"add      {it['title']}" + (f"  (due {it['due']})" if it["due"] else ""))
        if not a.dry_run:
            t = g.create_task(lst["id"], _new_task_body(it))
            state[it["id"]] = t["id"]
    for it, t, changes in plan["update"]:
        say(f"update   {it['title']}  ({', '.join(k.replace('dueDateTime', 'due date') for k in changes)})")
        if not a.dry_run:
            g.update_task(lst["id"], t["id"], changes)
    for it, t in plan["complete"]:
        say(f"complete {it['title']}")
        if not a.dry_run:
            g.update_task(lst["id"], t["id"], {"status": "completed"})
    if not (plan["create"] or plan["update"] or plan["complete"]):
        print("  Everything already matches.")
    if plan["completed_in_todo"]:
        print(f"\nYou finished {len(plan['completed_in_todo'])} in To Do that the dashboard still shows as open:")
        for c in plan["completed_in_todo"]:
            print(f"  [x] {c['title']}")
        print('Tell Claude, or share the report file, so the dashboard can be updated.')

    if not a.dry_run:
        state_all[lst["id"]] = state
        _write_json(STATE_FILE, state_all)
    report = {
        "synced_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "list": lst["displayName"],
        "dry_run": a.dry_run,
        "added": [i["id"] for i in plan["create"]],
        "updated": [i["id"] for i, _, _ in plan["update"]],
        "completed": [i["id"] for i, _ in plan["complete"]],
        "completed_in_todo": plan["completed_in_todo"],
    }
    report_path = Path(a.report) if a.report else Path(a.file).with_name("todo-sync-report.json")
    report_path.write_text(json.dumps(report, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    print(f"\nReport: {report_path}")


# --------------------------------------------------------------------------- main

def build_parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(prog="todo", description="Microsoft To Do from the command line, with Career Advisor dashboard sync.")
    p.add_argument("--version", action="version", version=f"career-todo {VERSION}")
    sub = p.add_subparsers(dest="cmd", required=True, metavar="command")

    s = sub.add_parser("login", help="sign in to your Microsoft account")
    s.add_argument("--tenant", choices=["common", "consumers", "organizations"], help="account type: common (default, either), consumers (personal Microsoft account), organizations (work/school)")
    s.add_argument("--client-id", help="use your own Azure app registration (see README)")
    s.set_defaults(fn=cmd_login)

    sub.add_parser("logout", help="forget your sign-in").set_defaults(fn=cmd_logout)
    sub.add_parser("whoami", help="show who you're signed in as").set_defaults(fn=cmd_whoami)
    sub.add_parser("lists", help="show your To Do lists").set_defaults(fn=cmd_lists)

    s = sub.add_parser("tasks", help="show tasks in a list")
    s.add_argument("--list", default=DEFAULT_LIST)
    s.add_argument("--all", action="store_true", help="include completed tasks")
    s.set_defaults(fn=cmd_tasks)

    s = sub.add_parser("add", help="add a task")
    s.add_argument("title")
    s.add_argument("--list", default=DEFAULT_LIST)
    s.add_argument("--due", help="YYYY-MM-DD, today or tomorrow")
    s.add_argument("--importance", choices=["low", "normal", "high"], default="normal")
    s.add_argument("--note")
    s.add_argument("--create", action="store_true", help="create the list if it doesn't exist")
    s.set_defaults(fn=cmd_add)

    s = sub.add_parser("done", help="complete a task by title (or part of it)")
    s.add_argument("query")
    s.add_argument("--list", default=DEFAULT_LIST)
    s.set_defaults(fn=cmd_done)

    s = sub.add_parser("sync", help="push a dashboard sync file into To Do")
    s.add_argument("file", help="the recruiting-sync.json Claude prepared")
    s.add_argument("--list", help=f'To Do list to use (default: the file\'s, else "{DEFAULT_LIST}")')
    s.add_argument("--dry-run", action="store_true", help="show what would change without changing anything")
    s.add_argument("--report", help="where to write the report (default: next to the sync file)")
    s.set_defaults(fn=cmd_sync)

    s = sub.add_parser("export", help="print a list's tasks as JSON")
    s.add_argument("--list", default=DEFAULT_LIST)
    s.add_argument("--out", help="write to this file instead of the screen")
    s.set_defaults(fn=cmd_export)
    return p


def main(argv=None) -> int:
    args = build_parser().parse_args(argv)
    try:
        args.fn(args)
        return 0
    except CliError as e:
        print(f"Error: {e}", file=sys.stderr)
        return 1
    except KeyboardInterrupt:
        print("\nStopped.", file=sys.stderr)
        return 130


if __name__ == "__main__":
    sys.exit(main())
