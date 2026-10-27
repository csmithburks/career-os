// Offline tests for the patched gmail-mcp-multi (no Google calls).
const test = require("node:test");
const assert = require("node:assert");
const { buildRawMessage, extractBody, htmlToText, tools } = require("../dist/tools/index.js");
const { SCOPES } = require("../dist/auth.js");

const b64 = (s) => Buffer.from(s, "utf-8").toString("base64").replace(/\+/g, "-").replace(/\//g, "_");
const unraw = (raw) => Buffer.from(raw.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf-8");

test("only read and draft permissions are requested", () => {
  assert.deepStrictEqual(SCOPES, [
    "https://www.googleapis.com/auth/gmail.readonly",
    "https://www.googleapis.com/auth/gmail.compose",
  ]);
});

test("no tool can send, delete or relabel mail", () => {
  const names = tools.map((t) => t.name);
  assert.deepStrictEqual(names.sort(), ["authenticate", "draft_email", "list_accounts", "list_labels", "read_email", "read_thread", "search_emails"].sort());
});

test("draft MIME: headers, UTF-8 subject, reply threading, body round-trips", () => {
  const raw = buildRawMessage({
    from: "you@gmail.com",
    to: ["Abby <ab@example.com>"],
    cc: ["x@example.com"],
    subject: "Thanks — great chat",
    body: "Hi Abby,\nThanks again.\n\nChris",
    inReplyTo: "<abc@mail.gmail.com>",
    references: "<abc@mail.gmail.com>",
  });
  assert.ok(!/[+/=]/.test(raw), "base64url, unpadded");
  const msg = unraw(raw);
  assert.match(msg, /^From: you@gmail.com\r\n/);
  assert.match(msg, /\r\nTo: Abby <ab@example.com>\r\n/);
  assert.match(msg, /\r\nCc: x@example.com\r\n/);
  assert.match(msg, /\r\nSubject: =\?UTF-8\?B\?.+\?=\r\n/);
  const enc = msg.match(/Subject: =\?UTF-8\?B\?(.+)\?=/)[1];
  assert.strictEqual(Buffer.from(enc, "base64").toString("utf-8"), "Thanks — great chat");
  assert.match(msg, /\r\nIn-Reply-To: <abc@mail.gmail.com>\r\n/);
  const body = msg.split("\r\n\r\n").slice(1).join("\r\n\r\n").replace(/\r\n/g, "");
  assert.strictEqual(Buffer.from(body, "base64").toString("utf-8"), "Hi Abby,\r\nThanks again.\r\n\r\nChris");
});

test("header injection via newlines is neutralised", () => {
  const msg = unraw(buildRawMessage({ to: ["a@b.com\r\nBcc: evil@x.com"], subject: "hi\r\nBcc: evil@x.com", body: "x" }));
  assert.ok(!/\r\nBcc: evil/.test(msg));
});

test("body extraction prefers text/plain, falls back to HTML, lists attachments", () => {
  const payload = {
    mimeType: "multipart/mixed",
    parts: [
      { mimeType: "multipart/alternative", parts: [
        { mimeType: "text/plain", body: { data: b64("Plain body ✓") } },
        { mimeType: "text/html", body: { data: b64("<p>HTML</p>") } },
      ] },
      { mimeType: "application/pdf", filename: "resume.pdf", body: { attachmentId: "A1" } },
    ],
  };
  assert.deepStrictEqual(extractBody(payload), { text: "Plain body ✓", attachments: ["resume.pdf"] });
  const htmlOnly = { mimeType: "text/html", body: { data: b64("<div>Hi&nbsp;Chris<br>Line 2</div><style>x{}</style>") } };
  assert.strictEqual(extractBody(htmlOnly).text, "Hi Chris\nLine 2");
  assert.strictEqual(htmlToText("<ul><li>a</li><li>b</li></ul>"), "- a\n- b");
});
