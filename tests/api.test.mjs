import assert from "node:assert/strict";
import test from "node:test";
import { createServer } from "node:http";
import { handleApi, safeTarget } from "../worker/api.js";
import { localDb } from "../server/local-db.js";
async function fixture(t, { status = 200, delay = 0 } = {}) {
  const db = localDb(":memory:");
  let token = "",
    calls = [],
    starts = [],
    network = 0;
  const server = createServer((req, res) => {
    calls.push(req.headers);
    if (req.url === "/.well-known/site-check.txt") {
      res.end(token);
      return;
    }
    if (
      req.url === "/" &&
      req.headers["user-agent"]?.includes("(ownership verification)")
    ) {
      res.setHeader("Content-Type", "text/html");
      res.end(`<html><head><meta name="site-check" content="${token}"></head><body>fixture</body></html>`);
      return;
    }
    starts.push(Date.now());
    network++;
    setTimeout(
      () => {
        res.writeHead(typeof status === "function" ? status(network) : status);
        res.end("fixture page");
      },
      typeof delay === "function" ? delay(network) : delay,
    );
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  t.after(() => {
    server.closeAllConnections();
    server.close();
    db.sqlite.close();
  });
  const fetcher = (url, opts) =>
    fetch(
      "http://127.0.0.1:" + server.address().port + new URL(url).pathname,
      opts,
    );
  let cookie = "";
  async function request(route, body, session = cookie) {
    const r = await handleApi(
      new Request("https://checker.test/api/" + route, {
        method: "POST",
        headers: {
          Origin: "https://checker.test",
          "Content-Type": "application/json",
          Cookie: session,
        },
        body: JSON.stringify(body),
      }),
      { DB: db },
      {},
      { fetcher },
    );
    if (session === cookie && r.headers.get("set-cookie"))
      cookie = r.headers.get("set-cookie").split(";")[0];
    return r;
  }
  async function setup() {
    const r = await request("challenge", {
        url: "https://owned-fixture.vercel.app/",
      }),
      c = await r.json();
    assert.equal(r.status, 200);
    token = c.token;
    assert.equal((await request("verify", { id: c.id })).status, 200);
    return c;
  }
  return {
    db,
    request,
    setup,
    calls,
    starts,
    get count() {
      return network;
    },
    setToken: (v) => {
      token = v;
    },
  };
}
test("accepts public custom domains and rejects private or malformed targets", () => {
  for (const url of [
    "http://foo.vercel.app",
    "https://127.0.0.1",
    "https://127.1",
    "https://[::1]",
    "https://u:p@x.vercel.app",
    "https://x.vercel.app:444",
    "https://x.vercel.app/?key=a",
    "https://x.vercel.app/#a",
    "https://localhost",
    "https://x.vercel.app./",
    "https://-bad.example.com",
    "https://bad-.example.com",
    "https://bad_name.example.com",
    "https://example..com/",
  ])
    assert.throws(() => safeTarget(url), url);
  assert.equal(
    safeTarget("https://hello.vercel.app/a").origin,
    "https://hello.vercel.app",
  );
  assert.equal(
    safeTarget("https://www.linkarabs.com/").origin,
    "https://www.linkarabs.com",
  );
});
test("requires ownership and keeps public proof bound to a private browser session", async (t) => {
  const f = await fixture(t),
    r = await f.request("challenge", {
      url: "https://owned-fixture.vercel.app/",
    }),
    c = await r.json();
  assert.equal(
    (await f.request("run", { id: c.id, plan: "quick" })).status,
    403,
  );
  assert.equal(f.count, 0);
  assert.equal((await f.request("verify", { id: c.id }, "")).status, 403);
  assert.equal(f.calls.length, 0);
  f.setToken("wrong proof");
  assert.equal((await f.request("verify", { id: c.id })).status, 400);
  assert.equal(
    (await f.request("run", { id: c.id, plan: "quick" })).status,
    403,
  );
});
test("makes 10 genuine HTTP requests within the fixed quick budget, without forwarding cookies", async (t) => {
  const f = await fixture(t, { delay: 12 }),
    c = await f.setup(),
    r = await f.request("run", { id: c.id, plan: "quick" }),
    events = (await r.text()).trim().split("\n").map(JSON.parse),
    report = events.find((e) => e.type === "done").result;
  assert.equal(f.count, 10);
  assert.equal(report.count, 10);
  assert.equal(report.failures, 0);
  assert.ok(report.avg > 0);
  assert.equal(report.concurrency, 1);
  assert.equal(report.maxRequests, 10);
  assert.ok(report.durationMs < 11500);
  assert.ok(f.starts.slice(1).every((n, i) => n - f.starts[i] >= 950));
  assert.ok(f.calls.every((h) => !h.cookie && !h.authorization));
  assert.ok(
    f.calls.every((h) => h["user-agent"].startsWith("WebsiteCheck/1.0")),
  );
  assert.equal(
    (await f.request("run", { id: c.id, plan: "quick" })).status,
    403,
  );
});
test("automatically stops on 429 after a single real request", async (t) => {
  const f = await fixture(t, { status: 429 }),
    c = await f.setup(),
    r = await f.request("run", { id: c.id, plan: "standard" }),
    events = (await r.text()).trim().split("\n").map(JSON.parse);
  assert.equal(f.count, 1);
  assert.equal(events.at(-1).result.failures, 1);
  assert.match(events.at(-1).result.reason, /توقف/);
});
test("does not burst to catch up after slow responses, and stops after three errors", async (t) => {
  const f = await fixture(t, {
      status: (n) => (n === 1 ? 200 : 500),
      delay: (n) => (n === 1 ? 850 : 0),
    }),
    c = await f.setup(),
    r = await f.request("run", { id: c.id, plan: "standard" });
  await r.text();
  assert.equal(f.count, 4);
  assert.ok(f.starts.slice(1).every((n, i) => n - f.starts[i] >= 310));
});
test("manual stop is session-bound and prevents the remaining requests", async (t) => {
  const f = await fixture(t, { delay: 20 }),
    c = await f.setup(),
    r = await f.request("run", { id: c.id, plan: "standard" }),
    reader = r.body.getReader(),
    decoder = new TextDecoder();
  let pending = "",
    job,
    done;
  while (true) {
    const chunk = await reader.read();
    if (chunk.done) break;
    pending += decoder.decode(chunk.value);
    let index;
    while ((index = pending.indexOf("\n")) >= 0) {
      const e = JSON.parse(pending.slice(0, index));
      pending = pending.slice(index + 1);
      if (e.type === "start") {
        job = e.id;
        assert.equal((await f.request("stop", { id: job }, "")).status, 404);
        assert.equal((await f.request("stop", { id: job })).status, 200);
      }
      if (e.type === "done") done = e.result;
    }
  }
  assert.ok(f.count <= 1);
  assert.match(done.reason, /بطلبك/);
});
test("cross-origin API requests and prototype plan keys are rejected", async (t) => {
  const f = await fixture(t),
    r = await handleApi(
      new Request("https://checker.test/api/challenge", {
        method: "POST",
        headers: {
          Origin: "https://elsewhere.test",
          "Content-Type": "application/json",
        },
        body: "{}",
      }),
      { DB: f.db },
    );
  assert.equal(r.status, 403);
  const c = await f.setup();
  assert.equal(
    (await f.request("run", { id: c.id, plan: "__proto__" })).status,
    400,
  );
  assert.equal(f.count, 0);
});
