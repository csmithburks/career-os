import { google } from "googleapis";
import * as http from "http";
import * as fs from "fs";
import { exec } from "child_process";
import { AccountManager } from "./accounts.js";

/**
 * Read + drafts only. Google has no "drafts without sending" scope:
 * gmail.compose technically allows sending, so this server simply exposes
 * no send tool. Nothing here can send, delete, or relabel mail.
 */
export const SCOPES = [
  "https://www.googleapis.com/auth/gmail.readonly",
  "https://www.googleapis.com/auth/gmail.compose",
];

const SIGN_IN_WINDOW_MS = 10 * 60 * 1000;

export interface AuthResult {
  success: boolean;
  message: string;
  alias?: string;
  email?: string;
}

export interface StartedAuth {
  authUrl: string;
  done: Promise<AuthResult>;
}

function readOAuthKeys(accountManager: AccountManager): { client_id: string; client_secret: string } {
  const p = accountManager.getOAuthKeysPath();
  if (!fs.existsSync(p)) {
    throw new Error(
      `Google OAuth client file not found. Save the JSON you downloaded from Google Cloud as ${p}`
    );
  }
  const raw = JSON.parse(fs.readFileSync(p, "utf-8"));
  const keys = raw.installed ?? raw.web;
  if (!keys?.client_id || !keys?.client_secret) {
    throw new Error(
      `${p} doesn't look like a Google OAuth client file (expected an "installed" section). Create a "Desktop app" OAuth client and download its JSON.`
    );
  }
  return keys;
}

/** Open a URL in the default browser. On Windows, `start` needs an empty title argument first. */
export function openBrowser(target: string): void {
  const quoted = `"${target.replace(/"/g, "%22")}"`;
  const cmd =
    process.platform === "win32"
      ? `start "" ${quoted}`
      : process.platform === "darwin"
      ? `open ${quoted}`
      : `xdg-open ${quoted}`;
  exec(cmd, () => {
    /* ignore: the link is also shown to the user */
  });
}

function listen(server: http.Server): Promise<number> {
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const addr = server.address();
      resolve(typeof addr === "object" && addr ? addr.port : 0);
    });
  });
}

const page = (title: string, body: string, ok: boolean) => `<!doctype html><meta charset="utf-8">
<title>${title}</title>
<body style="font-family:system-ui;display:flex;justify-content:center;align-items:center;height:100vh;margin:0">
<div style="text-align:center;max-width:32rem"><h1 style="color:${ok ? "#16a34a" : "#dc2626"}">${title}</h1><p>${body}</p></div>`;

const escapeHtml = (s: string) =>
  s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));

/**
 * Start the Google sign-in for one account. Returns the sign-in link at once;
 * `done` settles when the browser comes back (or after 10 minutes).
 */
export async function startAuthentication(
  accountManager: AccountManager,
  alias: string,
  emailHint?: string,
  onSaved?: (alias: string) => void
): Promise<StartedAuth> {
  if (!/^[A-Za-z0-9_-]{1,40}$/.test(alias)) {
    throw new Error(`Alias "${alias}" should be letters, numbers, - or _ (e.g. "wharton", "personal").`);
  }
  const { client_id, client_secret } = readOAuthKeys(accountManager);

  const server = http.createServer();
  const port = await listen(server);
  const redirectUri = `http://127.0.0.1:${port}`;
  const oauth2Client = new google.auth.OAuth2(client_id, client_secret, redirectUri);
  const authUrl = oauth2Client.generateAuthUrl({
    access_type: "offline",
    scope: SCOPES,
    prompt: "consent",
    login_hint: emailHint,
    include_granted_scopes: true,
  });

  const done = new Promise<AuthResult>((resolve) => {
    let settled = false;
    const finish = (r: AuthResult) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      setTimeout(() => server.close(), 500);
      resolve(r);
    };
    const timer = setTimeout(
      () => finish({ success: false, message: `Sign-in for "${alias}" timed out after 10 minutes. Try again.` }),
      SIGN_IN_WINDOW_MS
    );

    server.on("request", async (req, res) => {
      const u = new URL(req.url || "/", redirectUri);
      if (u.pathname !== "/") {
        res.writeHead(404).end();
        return;
      }
      const err = u.searchParams.get("error");
      const code = u.searchParams.get("code");
      if (err || !code) {
        res.writeHead(400, { "Content-Type": "text/html; charset=utf-8" });
        res.end(page("Sign-in didn't finish", escapeHtml(err ? `Google said: ${err}` : "No authorization code came back."), false));
        finish({ success: false, message: `Sign-in for "${alias}" failed: ${err || "no code returned"}` });
        return;
      }
      try {
        const { tokens } = await oauth2Client.getToken(code);
        if (!tokens.refresh_token) {
          throw new Error("Google didn't return a refresh token. Remove the app's access at myaccount.google.com/permissions and sign in again.");
        }
        oauth2Client.setCredentials(tokens);
        const gmail = google.gmail({ version: "v1", auth: oauth2Client });
        const profile = await gmail.users.getProfile({ userId: "me" });
        const email = profile.data.emailAddress || emailHint || "unknown";
        if (emailHint && email.toLowerCase() !== emailHint.toLowerCase()) {
          throw new Error(`You signed in as ${email}, but this sign-in was for ${emailHint}. Run it again and pick ${emailHint}.`);
        }
        accountManager.addAccount(alias, email);
        accountManager.saveCredentials(alias, tokens);
        onSaved?.(alias);
        res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
        res.end(page("Connected", `${escapeHtml(email)} is connected as <b>${escapeHtml(alias)}</b>. You can close this tab.`, true));
        finish({ success: true, message: `Connected ${alias} (${email}).`, alias, email });
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        res.writeHead(500, { "Content-Type": "text/html; charset=utf-8" });
        res.end(page("Sign-in failed", escapeHtml(msg), false));
        finish({ success: false, message: `Sign-in for "${alias}" failed: ${msg}` });
      }
    });
  });

  return { authUrl, done };
}

/** Terminal sign-in: npm run auth -- <alias> <email> */
async function cli(): Promise<void> {
  const [alias, email] = process.argv.slice(2);
  if (!alias) {
    console.log("Usage: npm run auth -- <alias> <email>\n  e.g. npm run auth -- personal you@gmail.com");
    process.exit(1);
  }
  const accountManager = new AccountManager();
  try {
    const { authUrl, done } = await startAuthentication(accountManager, alias, email);
    console.log(`\nOpening your browser to sign in${email ? ` as ${email}` : ""}...`);
    console.log(`If it doesn't open, copy this link into your browser:\n\n${authUrl}\n`);
    openBrowser(authUrl);
    const r = await done;
    console.log(r.message);
    process.exit(r.success ? 0 : 1);
  } catch (e) {
    console.error(e instanceof Error ? e.message : String(e));
    process.exit(1);
  }
}

if (require.main === module) {
  void cli();
}
