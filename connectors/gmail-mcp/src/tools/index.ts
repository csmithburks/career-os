import { Tool, CallToolRequest } from "@modelcontextprotocol/sdk/types.js";
import type { gmail_v1 } from "googleapis";
import { AccountManager } from "../accounts.js";
import { GmailClient } from "../gmail.js";
import { startAuthentication, openBrowser } from "../auth.js";

// Read + drafts only: there is deliberately no send, delete or label-changing tool.

const ACCOUNT = { type: "string", description: "Account alias (e.g. 'wharton', 'personal') or email address" };

export const tools: Tool[] = [
  {
    name: "list_accounts",
    description: "List the connected Gmail accounts, their aliases and whether each is signed in",
    inputSchema: { type: "object", properties: {}, required: [] },
  },
  {
    name: "authenticate",
    description:
      "Connect (or reconnect) a Gmail account. Opens Google sign-in in the browser and returns the sign-in link; the person finishes signing in there, then list_accounts shows it as connected.",
    inputSchema: {
      type: "object",
      properties: {
        alias: { type: "string", description: "Short name for the account, e.g. 'wharton' or 'personal'" },
        email: { type: "string", description: "The account's email address (pre-fills Google sign-in and is checked afterwards)" },
      },
      required: ["alias"],
    },
  },
  {
    name: "search_emails",
    description:
      "Search one account with Gmail query syntax (e.g. 'from:abby newer_than:7d', 'in:sent to:kevin'). Returns id, threadId, from, to, subject, date and snippet.",
    inputSchema: {
      type: "object",
      properties: {
        account: ACCOUNT,
        query: { type: "string", description: "Gmail search query" },
        maxResults: { type: "number", description: "1-50 (default 10)" },
        pageToken: { type: "string", description: "nextPageToken from a previous search, for more results" },
      },
      required: ["account", "query"],
    },
  },
  {
    name: "read_email",
    description: "Read one email: headers and plain-text body (HTML converted to text), plus attachment names",
    inputSchema: {
      type: "object",
      properties: { account: ACCOUNT, messageId: { type: "string", description: "Message id from search_emails" } },
      required: ["account", "messageId"],
    },
  },
  {
    name: "read_thread",
    description: "Read a whole conversation, oldest message first, each with headers and plain-text body",
    inputSchema: {
      type: "object",
      properties: { account: ACCOUNT, threadId: { type: "string", description: "threadId from search_emails" } },
      required: ["account", "threadId"],
    },
  },
  {
    name: "draft_email",
    description:
      "Create a draft in the account's Drafts folder (never sends). To draft a reply, pass replyToMessageId and the draft joins that conversation.",
    inputSchema: {
      type: "object",
      properties: {
        account: ACCOUNT,
        to: { type: "array", items: { type: "string" }, description: "Recipients" },
        subject: { type: "string", description: "Subject (for a reply, defaults to 'Re: <original subject>')" },
        body: { type: "string", description: "Plain-text body" },
        cc: { type: "array", items: { type: "string" } },
        bcc: { type: "array", items: { type: "string" } },
        replyToMessageId: { type: "string", description: "Message id to reply to (optional)" },
      },
      required: ["account", "body"],
    },
  },
  {
    name: "list_labels",
    description: "List an account's labels (ids and names), for use in search queries",
    inputSchema: { type: "object", properties: { account: ACCOUNT }, required: ["account"] },
  },
];

// ------------------------------------------------------------------ helpers

type Part = gmail_v1.Schema$MessagePart;

export function decodeB64Url(data?: string | null): string {
  if (!data) return "";
  return Buffer.from(data.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf-8");
}

export function htmlToText(html: string): string {
  return html
    .replace(/<(script|style)[\s\S]*?<\/\1>/gi, "")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|tr|li|h[1-6])>/gi, "\n")
    .replace(/<li[^>]*>/gi, "- ")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export function extractBody(part?: Part): { text: string; attachments: string[] } {
  const plain: string[] = [];
  const html: string[] = [];
  const attachments: string[] = [];
  const walk = (p?: Part) => {
    if (!p) return;
    if (p.filename && p.body?.attachmentId) {
      attachments.push(p.filename);
      return;
    }
    if (p.mimeType === "text/plain" && p.body?.data) plain.push(decodeB64Url(p.body.data));
    else if (p.mimeType === "text/html" && p.body?.data) html.push(decodeB64Url(p.body.data));
    (p.parts || []).forEach(walk);
  };
  walk(part);
  const text = plain.length ? plain.join("\n") : htmlToText(html.join("\n"));
  return { text: text.length > 20000 ? text.slice(0, 20000) + "\n[... truncated]" : text, attachments };
}

const header = (m: gmail_v1.Schema$Message, name: string) =>
  m.payload?.headers?.find((h) => h.name?.toLowerCase() === name.toLowerCase())?.value || undefined;

function summarizeMessage(m: gmail_v1.Schema$Message) {
  const { text, attachments } = extractBody(m.payload);
  return {
    id: m.id,
    threadId: m.threadId,
    from: header(m, "From"),
    to: header(m, "To"),
    cc: header(m, "Cc"),
    date: header(m, "Date"),
    subject: header(m, "Subject"),
    labels: m.labelIds,
    attachments: attachments.length ? attachments : undefined,
    body: text,
  };
}

function encodeHeader(v: string): string {
  return /^[\x20-\x7e]*$/.test(v) ? v : `=?UTF-8?B?${Buffer.from(v, "utf-8").toString("base64")}?=`;
}

const cleanAddr = (a: string) => a.replace(/[\r\n]/g, "").trim();

/** Build an RFC 2822 message and return it base64url-encoded for the Gmail API. */
export function buildRawMessage(opts: {
  from?: string;
  to?: string[];
  cc?: string[];
  bcc?: string[];
  subject: string;
  body: string;
  inReplyTo?: string;
  references?: string;
}): string {
  const lines: string[] = [];
  if (opts.from) lines.push(`From: ${cleanAddr(opts.from)}`);
  if (opts.to?.length) lines.push(`To: ${opts.to.map(cleanAddr).join(", ")}`);
  if (opts.cc?.length) lines.push(`Cc: ${opts.cc.map(cleanAddr).join(", ")}`);
  if (opts.bcc?.length) lines.push(`Bcc: ${opts.bcc.map(cleanAddr).join(", ")}`);
  lines.push(`Subject: ${encodeHeader(opts.subject.replace(/[\r\n]/g, " "))}`);
  if (opts.inReplyTo) lines.push(`In-Reply-To: ${opts.inReplyTo}`);
  if (opts.references) lines.push(`References: ${opts.references}`);
  lines.push("MIME-Version: 1.0", 'Content-Type: text/plain; charset="UTF-8"', "Content-Transfer-Encoding: base64", "");
  const body = Buffer.from(opts.body.replace(/\r?\n/g, "\r\n"), "utf-8").toString("base64").replace(/.{76}/g, "$&\r\n");
  const raw = lines.join("\r\n") + "\r\n" + body;
  return Buffer.from(raw, "utf-8").toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

const ok = (data: unknown) => ({ content: [{ type: "text" as const, text: typeof data === "string" ? data : JSON.stringify(data, null, 2) }] });

// ------------------------------------------------------------------ handler

export async function handleToolCall(
  request: CallToolRequest,
  accountManager: AccountManager,
  gmailClient: GmailClient
): Promise<{ content: Array<{ type: "text"; text: string }>; isError?: boolean }> {
  const { name } = request.params;
  const args = (request.params.arguments || {}) as Record<string, any>;

  try {
    switch (name) {
      case "list_accounts":
        return ok({ accounts: accountManager.listAccounts() });

      case "authenticate": {
        const alias = String(args.alias || "").trim();
        const email = args.email ? String(args.email).trim() : undefined;
        const { authUrl, done } = await startAuthentication(accountManager, alias, email, (a) => gmailClient.clearClient(a));
        openBrowser(authUrl);
        done.then((r) => console.error(`[gmail-mcp-multi] ${r.message}`));
        return ok(
          `A Google sign-in page for "${alias}"${email ? ` (${email})` : ""} should have opened in the browser. ` +
            `If it didn't, open this link:\n\n${authUrl}\n\n` +
            `After signing in and approving, run list_accounts to confirm it shows authenticated: true. The link works for 10 minutes.`
        );
      }

      case "search_emails": {
        const client = await gmailClient.getClient(args.account);
        const maxResults = Math.max(1, Math.min(50, Number(args.maxResults) || 10));
        const list = await client.users.messages.list({ userId: "me", q: args.query, maxResults, pageToken: args.pageToken });
        const messages = await Promise.all(
          (list.data.messages || []).map(async (m) => {
            const full = await client.users.messages.get({
              userId: "me",
              id: m.id!,
              format: "metadata",
              metadataHeaders: ["From", "To", "Subject", "Date"],
            });
            return {
              id: m.id,
              threadId: m.threadId,
              from: header(full.data, "From"),
              to: header(full.data, "To"),
              subject: header(full.data, "Subject"),
              date: header(full.data, "Date"),
              snippet: full.data.snippet,
              labels: full.data.labelIds,
            };
          })
        );
        return ok({ account: args.account, count: messages.length, nextPageToken: list.data.nextPageToken, messages });
      }

      case "read_email": {
        const client = await gmailClient.getClient(args.account);
        const m = await client.users.messages.get({ userId: "me", id: args.messageId, format: "full" });
        return ok(summarizeMessage(m.data));
      }

      case "read_thread": {
        const client = await gmailClient.getClient(args.account);
        const t = await client.users.threads.get({ userId: "me", id: args.threadId, format: "full" });
        return ok({ threadId: t.data.id, messages: (t.data.messages || []).map(summarizeMessage) });
      }

      case "draft_email": {
        const client = await gmailClient.getClient(args.account);
        let subject: string = args.subject || "";
        let to: string[] = Array.isArray(args.to) ? args.to : args.to ? [String(args.to)] : [];
        let threadId: string | undefined;
        let inReplyTo: string | undefined;
        let references: string | undefined;
        if (args.replyToMessageId) {
          const orig = await client.users.messages.get({
            userId: "me",
            id: args.replyToMessageId,
            format: "metadata",
            metadataHeaders: ["Subject", "From", "Reply-To", "Message-ID", "References"],
          });
          threadId = orig.data.threadId || undefined;
          inReplyTo = header(orig.data, "Message-ID");
          references = [header(orig.data, "References"), inReplyTo].filter(Boolean).join(" ") || undefined;
          const origSubject = header(orig.data, "Subject") || "";
          if (!subject) subject = /^re:/i.test(origSubject) ? origSubject : `Re: ${origSubject}`;
          if (!to.length) {
            const r = header(orig.data, "Reply-To") || header(orig.data, "From");
            if (r) to = [r];
          }
        }
        if (!to.length) throw new Error("Add at least one recipient in 'to' (or pass replyToMessageId).");
        const profile = await client.users.getProfile({ userId: "me" });
        const raw = buildRawMessage({
          from: profile.data.emailAddress || undefined,
          to,
          cc: args.cc,
          bcc: args.bcc,
          subject,
          body: String(args.body),
          inReplyTo,
          references,
        });
        const d = await client.users.drafts.create({ userId: "me", requestBody: { message: { raw, threadId } } });
        return ok({
          draftId: d.data.id,
          messageId: d.data.message?.id,
          threadId: d.data.message?.threadId,
          account: profile.data.emailAddress,
          note: "Saved to Drafts. Nothing was sent.",
        });
      }

      case "list_labels": {
        const client = await gmailClient.getClient(args.account);
        const r = await client.users.labels.list({ userId: "me" });
        return ok((r.data.labels || []).map((l) => ({ id: l.id, name: l.name, type: l.type })));
      }

      default:
        return { ...ok(`Unknown tool: ${name}`), isError: true };
    }
  } catch (error: any) {
    const status = error?.code || error?.response?.status;
    let message = error instanceof Error ? error.message : String(error);
    if (status === 401 || /invalid_grant/i.test(message)) {
      message = `The sign-in for "${args.account}" expired or was revoked. Run authenticate for that account again. (${message})`;
    } else if (status === 403 && /insufficient|scope/i.test(message)) {
      message = `Google refused: this account hasn't granted the needed permission. Run authenticate again and approve all requested access. (${message})`;
    }
    return { ...ok(`Error: ${message}`), isError: true };
  }
}
