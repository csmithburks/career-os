# Career To Do CLI

A small command-line tool that connects to **Microsoft To Do** and keeps a "Recruiting" list in step with your Career Advisor dashboard. It's one Python file with no extra packages.

## One-time setup (about 5 minutes)

1. **Install Python** (skip this if `python --version` works in PowerShell).
   Run `winget install Python.Python.3.12` in PowerShell, or download it from python.org.
   Close and reopen PowerShell afterwards.

2. **Open this folder in PowerShell.**
   In File Explorer, open this folder, click the address bar, type `powershell`, and press Enter.

3. **Sign in:**
   ```
   .\todo login
   ```
   It prints a short code and a link (microsoft.com/devicelogin). Open the link, enter the code and sign in with the Microsoft account your To Do lives on. The tool never sees your password.
   - Personal Microsoft account (Outlook.com, Hotmail, Live): `.\todo login --tenant consumers`
   - Penn/Wharton account: `.\todo login --tenant organizations`

## Everyday use

| What | Command |
| --- | --- |
| See your lists | `.\todo lists` |
| See open recruiting tasks | `.\todo tasks` |
| Include completed ones | `.\todo tasks --all` |
| Add a task | `.\todo add "Email Abby" --due 2026-10-21 --importance high` |
| Complete a task (any unique part of the title) | `.\todo done "Abby"` |
| Use another list | add `--list "Groceries"` to any command |

## Syncing with the dashboard

Claude writes `recruiting-sync.json` into this folder whenever it refreshes your dashboard. To push it into To Do:

```
.\todo sync recruiting-sync.json --dry-run    # preview, changes nothing
.\todo sync recruiting-sync.json              # do it
```

- Creates a **Recruiting** list if you don't have one.
- Adds new items, updates changed titles and due dates, and completes items the dashboard marks done.
- Safe to run as often as you like: it never creates duplicates. Each task it creates is tagged with its dashboard item, so it's recognized on the next run.
- Tasks you add yourself in To Do are left alone.
- If you checked something off in To Do that the dashboard still shows as open, it tells you, and writes `todo-sync-report.json` here. Tell Claude "I ran the To Do sync" and it will read the report and update the dashboard.

For Claude to see everything in the list, including tasks you added yourself:
```
.\todo export --out todo-export.json
```

## If sign-in is blocked

Some organizations (possibly Penn) block command-line apps they haven't approved. If `login` says the app needs admin approval, either sign in with a personal Microsoft account, or register your own free app:

1. Go to portal.azure.com, then **App registrations**, then **New registration**.
2. Name it "Career To Do". Under supported account types, choose **Accounts in any organizational directory and personal Microsoft accounts**. Click Register.
3. Open **Authentication**, set **Allow public client flows** to **Yes**, and save.
4. Open **API permissions**, then **Add a permission**, then **Microsoft Graph**, then **Delegated**, and add **Tasks.ReadWrite** and **User.Read**.
5. Copy the **Application (client) ID** from Overview, then run:
   `.\todo login --client-id <that id>`

## Privacy

Your sign-in is saved in `C:\Users\<you>\.career-todo\` on this computer only. `.\todo logout` deletes it. The tool only talks to Microsoft (login.microsoftonline.com and graph.microsoft.com).
