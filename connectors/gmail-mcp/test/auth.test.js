const test = require("node:test");
const assert = require("node:assert");
const fs = require("fs"); const os = require("os"); const path = require("path"); const http = require("http");
const home = fs.mkdtempSync(path.join(os.tmpdir(), "gmm-home-"));
process.env.HOME = home; process.env.USERPROFILE = home;
const { AccountManager } = require("../dist/accounts.js");
const { startAuthentication } = require("../dist/auth.js");
const g = require("googleapis");

const get = (url) => new Promise((res, rej) => http.get(url, (r) => { let b = ""; r.on("data", (c) => (b += c)); r.on("end", () => res({ status: r.statusCode, body: b })); }).on("error", rej));
const redirectOf = (authUrl) => decodeURIComponent(new URL(authUrl).searchParams.get("redirect_uri"));

test("missing client file gives a plain instruction", async () => {
  const am = new AccountManager();
  await assert.rejects(startAuthentication(am, "personal"), /oauth-keys.json/);
});

test("full sign-in round trip saves credentials per alias; wrong account is refused", async () => {
  fs.writeFileSync(path.join(home, ".gmail-mcp", "oauth-keys.json"), JSON.stringify({ installed: { client_id: "cid", client_secret: "sec", redirect_uris: ["http://localhost"] } }));
  const am = new AccountManager();
  await assert.rejects(startAuthentication(am, "bad alias!"), /Alias/);

  // personal: success
  let s = await startAuthentication(am, "personal", "you@gmail.com");
  assert.match(s.authUrl, /gmail.readonly/); assert.match(s.authUrl, /gmail.compose/); assert.doesNotMatch(s.authUrl, /gmail.send|gmail.modify/);
  let r = await get(redirectOf(s.authUrl) + "/?code=GOOD");
  assert.strictEqual(r.status, 200); assert.match(r.body, /Connected/);
  let done = await s.done; assert.ok(done.success, done.message);
  const cred = JSON.parse(fs.readFileSync(path.join(home, ".gmail-mcp/accounts/personal/credentials.json"), "utf-8"));
  assert.strictEqual(cred.refresh_token, "RT");

  // wharton: user picks the wrong Google account -> refused, nothing saved
  g.__state.email = "you@gmail.com";
  s = await startAuthentication(am, "wharton", "you@school.edu");
  r = await get(redirectOf(s.authUrl) + "/?code=GOOD");
  assert.strictEqual(r.status, 500); assert.match(r.body, /signed in as you@gmail.com/);
  done = await s.done; assert.ok(!done.success);
  assert.ok(!fs.existsSync(path.join(home, ".gmail-mcp/accounts/wharton/credentials.json")));

  // wharton: right account
  g.__state.email = "you@school.edu";
  s = await startAuthentication(am, "wharton", "you@school.edu");
  r = await get(redirectOf(s.authUrl) + "/?code=GOOD");
  done = await s.done; assert.ok(done.success, done.message);

  // Google sends back an error (e.g. Penn blocks the app)
  s = await startAuthentication(am, "wharton2", "you@school.edu");
  r = await get(redirectOf(s.authUrl) + "/?error=access_denied");
  done = await s.done; assert.ok(!done.success); assert.match(done.message, /access_denied/);

  const accounts = am.listAccounts();
  assert.deepStrictEqual(accounts.map((a) => [a.alias, a.email, a.authenticated]), [
    ["personal", "you@gmail.com", true],
    ["wharton", "you@school.edu", true],
  ]);
});
