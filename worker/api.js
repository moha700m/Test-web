export const PLANS = {
  quick: { duration: 10, rps: 1 },
  light: { duration: 20, rps: 2 },
  standard: { duration: 20, rps: 3 },
};
const id = () => crypto.randomUUID(),
  json = (data, status = 200, headers = {}) =>
    Response.json(data, {
      status,
      headers: { "Cache-Control": "no-store", ...headers },
    });
class Problem extends Error {
  constructor(message, status = 400) {
    super(message);
    this.status = status;
  }
}
export function safeTarget(raw) {
  let u;
  try {
    u = new URL(raw);
  } catch {
    throw new Problem("اكتب رابطًا كاملًا يبدأ بـ https://");
  }
  const h = u.hostname.toLowerCase();
  if (
    u.protocol !== "https:" ||
    u.username ||
    u.password ||
    u.port ||
    String(raw).length > 500 ||
    u.hash ||
    u.search
  )
    throw new Problem(
      "استخدم رابط HTTPS مباشر بدون بيانات دخول أو منفذ أو معاملات إضافية.",
    );
  const labels = h.split(".");
  if (
    h.length > 253 ||
    /^\d+(\.\d+){3}$/.test(h) ||
    h.includes(":") ||
    !h.includes(".") ||
    h === "localhost" ||
    h.endsWith(".localhost") ||
    h.endsWith(".local") ||
    h.endsWith(".internal") ||
    h.endsWith(".lan") ||
    h.endsWith(".home") ||
    !labels.every((label) =>
      /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(label),
    )
  )
    throw new Problem("استخدم دومين HTTPS عام صالح ومتاح على الإنترنت.");
  return u;
}
export function storeFor(db) {
  return {
    get: (sql, ...args) =>
      db
        .prepare(sql)
        .bind(...args)
        .first(),
    run: async (sql, ...args) => {
      const r = await db
        .prepare(sql)
        .bind(...args)
        .run();
      return r.meta?.changes ?? r.changes ?? 0;
    },
  };
}
export async function handleApi(request, env = {}, context = {}, deps = {}) {
  const path = new URL(request.url).pathname;
  if (
    !["/api/challenge", "/api/verify", "/api/run", "/api/stop"].includes(path)
  )
    return null;
  if (request.method !== "POST") return json({ error: "استخدم POST." }, 405);
  if (request.headers.get("Origin") !== new URL(request.url).origin)
    return json({ error: "الطلب لازم يكون من صفحة الخدمة." }, 403);
  if (!request.headers.get("Content-Type")?.startsWith("application/json"))
    return json({ error: "نوع الطلب غير صالح." }, 415);
  if (Number(request.headers.get("Content-Length") || 0) > 2048)
    return json({ error: "الطلب أكبر من المسموح." }, 413);
  if (!env.DB)
    return json({ error: "قاعدة بيانات الفحص غير متاحة. حاول لاحقًا." }, 503);
  const cookie = request.headers
      .get("Cookie")
      ?.match(/(?:^|;\s*)sitecheck_sid=([a-f0-9-]{36})(?:;|$)/)?.[1],
    session = cookie || id(),
    cookieHeader = !cookie
      ? {
          "Set-Cookie": `sitecheck_sid=${session}; Path=/; HttpOnly; SameSite=Strict; Max-Age=86400${new URL(request.url).protocol === "https:" ? "; Secure" : ""}`,
        }
      : {},
    store = storeFor(env.DB),
    fetcher = deps.fetcher || fetch;
  const reply = (d, status = 200) => json(d, status, cookieHeader);
  try {
    const raw = await request.text();
    if (raw.length > 2048) throw new Problem("الطلب أكبر من المسموح.", 413);
    let body;
    try {
      body = JSON.parse(raw);
    } catch {
      throw new Problem("طلب غير صالح.");
    }
    if (!body || typeof body !== "object") throw new Problem("طلب غير صالح.");
    if (path === "/api/challenge") {
      const u = safeTarget(body.url),
        now = Date.now(),
        cid = id(),
        token = "site-check-" + id();
      await store.run("DELETE FROM challenges WHERE expires < ?", now);
      const total = await store.get(
        "SELECT COUNT(*) AS n FROM challenges WHERE session = ?",
        session,
      );
      if (total.n >= 8)
        throw new Problem("وصلت الحد المؤقت للتحقق. حاول بعد 30 دقيقة.", 429);
      await store.run(
        "INSERT INTO challenges (id,session,origin,url,token,expires) VALUES (?,?,?,?,?,?)",
        cid,
        session,
        u.origin,
        u.href,
        token,
        now + 1800000,
      );
      return reply({
        id: cid,
        token,
        url: u.href,
        proofUrl: u.origin + "/.well-known/site-check.txt",
        expires: now + 1800000,
      });
    }
    if (path === "/api/stop") {
      const changed = await store.run(
        "UPDATE runs SET stopped = 1 WHERE id = ? AND session = ? AND finished = 0",
        String(body.id),
        session,
      );
      if (!changed) throw new Problem("الاختبار غير موجود أو انتهى.", 404);
      return reply({ ok: true });
    }
    const c = await store.get(
      "SELECT * FROM challenges WHERE id = ? AND session = ? AND expires > ?",
      String(body.id),
      session,
      Date.now(),
    );
    if (!c) throw new Problem("انتهت خطوة التحقق. جهّز اختبارًا جديدًا.", 403);
    safeTarget(c.url);
    async function prove() {
      await store.run(
        "INSERT OR IGNORE INTO hosts (origin) VALUES (?)",
        c.origin,
      );
      const changed = await store.run(
        "UPDATE hosts SET verify_at = ? WHERE origin = ? AND verify_at < ?",
        Date.now(),
        c.origin,
        Date.now() - 10000,
      );
      if (!changed)
        throw new Problem(
          "انتظر 10 ثوانٍ قبل إعادة التحقق من نفس الموقع.",
          429,
        );
      const controller = new AbortController(),
        timer = setTimeout(() => controller.abort(), 4000);
      try {
        const r = await fetcher(c.origin + "/.well-known/site-check.txt", {
          redirect: "manual",
          signal: controller.signal,
          headers: {
            "User-Agent": "WebsiteCheck/1.0 (ownership verification)",
            Accept: "text/plain",
          },
        });
        if (r.status !== 200) {
          await r.body?.cancel();
          throw new Problem(
            "ملف التحقق ما يظهر مباشرة. انشره وتأكد أنه يرجع HTTP 200 بدون تحويل.",
          );
        }
        if (Number(r.headers.get("content-length") || 0) > 1024) {
          await r.body?.cancel();
          throw new Problem("ملف التحقق لازم يكون ملفًا نصيًا صغيرًا.");
        }
        let text = "",
          bytes = 0;
        const reader = r.body?.getReader();
        if (reader) {
          while (true) {
            const { value, done } = await reader.read();
            if (done) break;
            bytes += value.length;
            if (bytes > 1024) {
              await reader.cancel();
              throw new Problem("ملف التحقق أكبر من المطلوب.");
            }
            text += new TextDecoder().decode(value);
          }
        }
        if (text.trim() !== c.token)
          throw new Problem(
            "نص ملف التحقق مو مطابق. انسخ البرومبت الحالي وانشر التعديل.",
          );
      } catch (e) {
        if (e instanceof Problem) throw e;
        throw new Problem(
          "تعذّر الوصول لملف التحقق خلال 4 ثوانٍ. تأكد أن الموقع منشور ومتاح.",
        );
      } finally {
        clearTimeout(timer);
      }
    }
    if (path === "/api/verify") {
      if (c.used)
        throw new Problem("هذا التحقق استُخدم. جهّز اختبارًا جديدًا.");
      const changed = await store.run(
        "UPDATE challenges SET attempts = attempts + 1 WHERE id = ? AND attempts < 3",
        c.id,
      );
      if (!changed)
        throw new Problem("وصلت 3 محاولات. جهّز التحقق من جديد.", 429);
      await prove();
      await store.run(
        "UPDATE challenges SET verified = ? WHERE id = ?",
        Date.now(),
        c.id,
      );
      return reply({ ok: true });
    }
    if (Number(c.verified) <= 0 || c.used)
      throw new Problem("تحقق من ملكية الموقع قبل تشغيل الاختبار.", 403);
    if (!Object.hasOwn(PLANS, body.plan))
      throw new Problem("نوع الاختبار غير صالح.");
    const plan = PLANS[body.plan];
    if (Date.now() - c.verified > 10000) await prove();
    const runId = id(),
      now = Date.now(),
      lock = await store.run(
        "UPDATE hosts SET locked_until = ?, last_started = ?, run_id = ? WHERE origin = ? AND locked_until < ? AND last_started < ?",
        now + 60000,
        now,
        runId,
        c.origin,
        now,
        now - 60000,
      );
    if (!lock)
      throw new Problem(
        "الموقع عليه اختبار الآن أو انتهى توه. انتظر دقيقة.",
        429,
      );
    const used = await store.run(
      "UPDATE challenges SET used = 1 WHERE id = ? AND used = 0",
      c.id,
    );
    if (!used) {
      await store.run(
        "UPDATE hosts SET locked_until = 0 WHERE origin = ? AND run_id = ?",
        c.origin,
        runId,
      );
      throw new Problem("تم استخدام هذا التحقق مسبقًا.", 403);
    }
    await store.run(
      "INSERT INTO runs (id,session,origin,started) VALUES (?,?,?,?)",
      runId,
      session,
      c.origin,
      now,
    );
    const encoder = new TextEncoder(),
      { readable, writable } = new TransformStream(),
      writer = writable.getWriter();
    let disconnected = false,
      currentController;
    const emit = async (o) => {
      try {
        await writer.write(encoder.encode(JSON.stringify(o) + "\n"));
      } catch {
        disconnected = true;
        currentController?.abort();
      }
    };
    const task = (async () => {
      const samples = [];
      let consecutive = 0,
        reason = "اكتملت مدة الاختبار.";
      const start = Date.now(),
        deadline = start + plan.duration * 1000;
      try {
        await emit({ type: "start", id: runId });
        for (
          let i = 0;
          i < plan.duration * plan.rps && Date.now() < deadline;
          i++
        ) {
          if (disconnected || request.signal.aborted) {
            reason = "تم إيقاف الاختبار بعد انقطاع الاتصال.";
            break;
          }
          const state = await store.get(
            "SELECT stopped FROM runs WHERE id = ?",
            runId,
          );
          if (state?.stopped) {
            reason = "تم إيقاف الاختبار بطلبك.";
            break;
          }
          const requestStart = Date.now(),
            began = performance.now();
          currentController = new AbortController();
          const timeout = setTimeout(
            () => currentController.abort(),
            Math.min(4000, Math.max(1, deadline - Date.now())),
          );
          let sample;
          try {
            const r = await fetcher(c.url, {
                method: "GET",
                redirect: "manual",
                signal: currentController.signal,
                headers: {
                  "User-Agent":
                    "WebsiteCheck/1.0 (verified bounded performance test)",
                  Accept: "text/html",
                },
              }),
              elapsed = performance.now() - began;
            await r.body?.cancel();
            sample = {
              ms: Math.round(elapsed * 100) / 100,
              status: r.status,
              ok: r.status >= 200 && r.status < 300,
              error:
                r.status >= 300 && r.status < 400
                  ? "إعادة توجيه"
                  : r.status >= 400
                    ? "HTTP " + r.status
                    : "",
            };
          } catch {
            sample = {
              ms: Math.round((performance.now() - began) * 100) / 100,
              status: 0,
              ok: false,
              error: "مهلة أو اتصال",
            };
          } finally {
            clearTimeout(timeout);
          }
          samples.push(sample);
          await emit({ type: "sample", sample });
          consecutive = sample.ok ? 0 : consecutive + 1;
          if (sample.status === 429 || sample.status === 503) {
            reason = "توقف تلقائيًا: الموقع طلب تقليل الحمل أو رجع 503.";
            break;
          }
          if (consecutive >= 3) {
            reason = "توقف تلقائيًا بعد 3 أخطاء متتالية.";
            break;
          }
          const wait = Math.min(
            Math.max(0, requestStart + 1000 / plan.rps - Date.now()),
            Math.max(0, deadline - Date.now()),
          );
          if (wait) await new Promise((r) => setTimeout(r, wait));
        }
        const good = samples
            .filter((s) => s.ok)
            .map((s) => s.ms)
            .sort((a, b) => a - b),
          result = {
            id: runId,
            url: c.url,
            plan: body.plan,
            started: new Date(start).toISOString(),
            durationMs: Date.now() - start,
            count: samples.length,
            failures: samples.filter((s) => !s.ok).length,
            avg: good.length
              ? good.reduce((a, n) => a + n, 0) / good.length
              : null,
            p95: good.length
              ? good[Math.max(0, Math.ceil(good.length * 0.95) - 1)]
              : null,
            reason,
            samples,
            measurement: "response_headers_latency",
            concurrency: 1,
            maxRequests: plan.duration * plan.rps,
          };
        await store.run(
          "UPDATE runs SET finished = 1, result = ? WHERE id = ?",
          JSON.stringify(result),
          runId,
        );
        await emit({ type: "done", result });
      } catch (e) {
        console.error("run failed", runId, e.message);
        await emit({
          type: "error",
          error: "تعذّر إكمال الاختبار. تقدر تعيد المحاولة بعد دقيقة.",
        });
      } finally {
        await store.run(
          "UPDATE hosts SET locked_until = 0 WHERE origin = ? AND run_id = ?",
          c.origin,
          runId,
        );
        await store.run("UPDATE runs SET finished = 1 WHERE id = ?", runId);
        try {
          await writer.close();
        } catch {}
      }
    })();
    if (context.waitUntil) context.waitUntil(task);
    else task.catch(console.error);
    return new Response(readable, {
      headers: {
        "Content-Type": "application/x-ndjson",
        "Cache-Control": "no-store",
        ...cookieHeader,
      },
    });
  } catch (e) {
    if (!(e instanceof Problem)) console.error("api failure", e.message);
    return reply(
      {
        error:
          e instanceof Problem
            ? e.message
            : "تعذّر الوصول لخدمة الفحص. حاول لاحقًا.",
      },
      e.status || 503,
    );
  }
}
