from pathlib import Path
import re

api = Path('worker/api.js')
text = api.read_text()

old_plans = '''export const PLANS = {
  quick: { duration: 10, rps: 1 },
  light: { duration: 20, rps: 2 },
  standard: { duration: 20, rps: 3 },
};'''
new_plans = '''export const PLANS = {
  quick: { duration: 10, rps: 1 },
  light: { duration: 20, rps: 2 },
  standard: { duration: 20, rps: 3 },
  ramp: {
    duration: 30,
    rps: 10,
    ramp: [1, 2, 4, 6, 8, 10],
    stageSeconds: 5,
  },
};'''
if old_plans not in text:
    raise SystemExit('PLANS block not found')
text = text.replace(old_plans, new_plans, 1)

text = text.replace(
    '''      if (c.used)
        throw new Problem("هذا التحقق استُخدم. جهّز اختبارًا جديدًا.");
''',
    '',
    1,
)

old_verify = '''      await store.run(
        "UPDATE challenges SET verified = ? WHERE id = ?",
        Date.now(),
        c.id,
      );
      return reply({ ok: true });'''
new_verify = '''      const verifiedAt = Date.now();
      await store.run(
        "UPDATE challenges SET verified = ?, expires = ? WHERE id = ?",
        verifiedAt,
        verifiedAt + 86400000,
        c.id,
      );
      return reply({ ok: true, verifiedUntil: verifiedAt + 86400000 });'''
if old_verify not in text:
    raise SystemExit('verify update block not found')
text = text.replace(old_verify, new_verify, 1)

old_guard = '''    if (Number(c.verified) <= 0 || c.used)
      throw new Problem("تحقق من ملكية الموقع قبل تشغيل الاختبار.", 403);'''
new_guard = '''    if (Number(c.verified) <= 0)
      throw new Problem("تحقق من ملكية الموقع قبل تشغيل الاختبار.", 403);'''
if old_guard not in text:
    raise SystemExit('verified guard not found')
text = text.replace(old_guard, new_guard, 1)

old_reprove = '    if (Date.now() - c.verified > 10000) await prove();'
new_reprove = '''    if (Date.now() - Number(c.verified) > 60000) {
      await prove();
      await store.run(
        "UPDATE challenges SET verified = ? WHERE id = ?",
        Date.now(),
        c.id,
      );
    }'''
if old_reprove not in text:
    raise SystemExit('reprove line not found')
text = text.replace(old_reprove, new_reprove, 1)

old_lock = '''      lock = await store.run(
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
    }'''
new_lock = '''      lock = await store.run(
        "UPDATE hosts SET locked_until = ?, last_started = ?, run_id = ? WHERE origin = ? AND locked_until < ?",
        now + 45000,
        now,
        runId,
        c.origin,
        now,
      );
    if (!lock)
      throw new Problem(
        "يوجد اختبار شغال على هذا الموقع الآن. انتظر لينتهي ثم أعد التشغيل.",
        429,
      );'''
if old_lock not in text:
    raise SystemExit('single-use/lock block not found')
text = text.replace(old_lock, new_lock, 1)

task_pattern = re.compile(r'''    const task = \(async \(\) => \{.*?\n    \}\)\(\);\n    if \(context\.waitUntil\)''', re.S)
task_new = '''    const task = (async () => {
      const samples = [];
      let consecutive = 0,
        reason = "اكتملت مدة الاختبار.",
        forcedDegradationRps = null;
      const start = Date.now(),
        deadline = start + plan.duration * 1000,
        maxRequests = plan.ramp
          ? plan.ramp.reduce((sum, rate) => sum + rate * plan.stageSeconds, 0)
          : plan.duration * plan.rps;
      const percentile95 = (values) => {
        if (!values.length) return null;
        const sorted = [...values].sort((a, b) => a - b);
        return sorted[Math.max(0, Math.ceil(sorted.length * 0.95) - 1)];
      };
      try {
        await emit({
          type: "start",
          id: runId,
          mode: plan.ramp ? "ramp" : "fixed",
          maxRequests,
          maxRps: plan.rps,
        });
        let sent = 0;
        while (sent < maxRequests && Date.now() < deadline) {
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

          const elapsed = Date.now() - start,
            stage = plan.ramp
              ? Math.min(
                  plan.ramp.length - 1,
                  Math.floor(elapsed / (plan.stageSeconds * 1000)),
                )
              : 0,
            targetRps = plan.ramp ? plan.ramp[stage] : plan.rps,
            requestStart = Date.now(),
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
                    "WebsiteCheck/1.0 (verified resilience test)",
                  Accept: "text/html",
                },
              }),
              elapsedMs = performance.now() - began;
            await r.body?.cancel();
            sample = {
              ms: Math.round(elapsedMs * 100) / 100,
              status: r.status,
              ok: r.status >= 200 && r.status < 300,
              error:
                r.status >= 300 && r.status < 400
                  ? "إعادة توجيه"
                  : r.status >= 400
                    ? "HTTP " + r.status
                    : "",
              targetRps,
              stage,
            };
          } catch {
            sample = {
              ms: Math.round((performance.now() - began) * 100) / 100,
              status: 0,
              ok: false,
              error: "مهلة أو اتصال",
              targetRps,
              stage,
            };
          } finally {
            clearTimeout(timeout);
          }

          samples.push(sample);
          sent++;
          await emit({ type: "sample", sample });
          consecutive = sample.ok ? 0 : consecutive + 1;

          if (sample.status === 429 || sample.status === 503) {
            forcedDegradationRps = targetRps;
            reason =
              "توقف تلقائيًا: الموقع طلب تقليل الحمل أو رجع 503 عند " +
              targetRps +
              " طلب/ثانية.";
            break;
          }
          if (consecutive >= 3) {
            forcedDegradationRps = targetRps;
            reason =
              "توقف تلقائيًا بعد 3 أخطاء متتالية عند " +
              targetRps +
              " طلب/ثانية.";
            break;
          }

          if (plan.ramp) {
            const window = samples
                .filter((s) => s.targetRps === targetRps)
                .slice(-10),
              failures = window.filter((s) => !s.ok).length,
              successMs = window.filter((s) => s.ok).map((s) => s.ms),
              windowP95 = percentile95(successMs),
              enough = window.length >= Math.min(5, targetRps * 2);
            if (
              enough &&
              (failures / window.length >= 0.2 ||
                (windowP95 != null && windowP95 > 2500))
            ) {
              forcedDegradationRps = targetRps;
              reason =
                "توقف تلقائيًا عند بداية التدهور: أخطاء 20%+ أو p95 أعلى من 2500ms عند " +
                targetRps +
                " طلب/ثانية.";
              break;
            }
          }

          const wait = Math.min(
            Math.max(0, requestStart + 1000 / targetRps - Date.now()),
            Math.max(0, deadline - Date.now()),
          );
          if (wait) await new Promise((r) => setTimeout(r, wait));
        }

        const good = samples
            .filter((s) => s.ok)
            .map((s) => s.ms)
            .sort((a, b) => a - b),
          rates = [...new Set(samples.map((s) => s.targetRps))].sort(
            (a, b) => a - b,
          ),
          stages = rates.map((targetRps) => {
            const rows = samples.filter((s) => s.targetRps === targetRps),
              ok = rows.filter((s) => s.ok),
              p95 = percentile95(ok.map((s) => s.ms));
            return {
              targetRps,
              count: rows.length,
              failures: rows.length - ok.length,
              successRate: rows.length ? ok.length / rows.length : 0,
              p95,
            };
          }),
          stableStages = stages.filter(
            (s) =>
              s.count >= 2 &&
              s.successRate >= 0.9 &&
              (s.p95 == null || s.p95 <= 2500),
          ),
          stableRps = stableStages.length
            ? stableStages[stableStages.length - 1].targetRps
            : 0,
          degradationStage = stages.find(
            (s) => s.successRate < 0.8 || (s.p95 != null && s.p95 > 2500),
          ),
          degradationRps =
            forcedDegradationRps ?? degradationStage?.targetRps ?? null,
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
            stages,
            stableRps,
            degradationRps,
            measurement: "response_headers_latency",
            concurrency: 1,
            maxRequests,
            maxRps: plan.rps,
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
          error:
            "تعذّر إكمال الاختبار. تقدر تعيد المحاولة بعد انتهاء التشغيل الحالي.",
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
    if (context.waitUntil)'''
text, n = task_pattern.subn(lambda _: task_new, text, count=1)
if n != 1:
    raise SystemExit('runner block not found')
api.write_text(text)

app = Path('src/App.jsx')
text = app.read_text()
old_ui_plans = '''const plans = [
  ["quick", "فحص سريع", 10, 1],
  ["light", "حمل خفيف", 20, 2],
  ["standard", "حمل محدود", 20, 3],
];'''
new_ui_plans = '''const plans = [
  ["quick", "فحص سريع", 10, 1],
  ["light", "حمل خفيف", 20, 2],
  ["standard", "حمل محدود", 20, 3],
  ["ramp", "تحمل متدرج", 30, 10, "30 ثانية · 1→10 طلب/ثانية"],
];'''
if old_ui_plans not in text:
    raise SystemExit('UI plans block not found')
text = text.replace(old_ui_plans, new_ui_plans, 1)

old_done = '''            if (e.type === "done") {
              setResult(e.result);
              setVerified(false);
              setMessage(e.result.reason);
            }'''
new_done = '''            if (e.type === "done") {
              setResult(e.result);
              setMessage(e.result.reason);
            }'''
if old_done not in text:
    raise SystemExit('done handler not found')
text = text.replace(old_done, new_done, 1)

old_metrics = '''  const good = samples.filter((s) => s.ok),
    avg = good.length ? good.reduce((a, s) => a + s.ms, 0) / good.length : null;'''
new_metrics = '''  const good = samples.filter((s) => s.ok),
    avg = good.length ? good.reduce((a, s) => a + s.ms, 0) / good.length : null,
    expectedRequests = chosen[0] === "ramp" ? 155 : chosen[2] * chosen[3],
    currentRps = samples.at(-1)?.targetRps || chosen[3];'''
if old_metrics not in text:
    raise SystemExit('metrics helper block not found')
text = text.replace(old_metrics, new_metrics, 1)

text = text.replace(
    '{plans.map(([id, label, seconds, rps]) => (',
    '{plans.map(([id, label, seconds, rps, note]) => (',
    1,
)
old_plan_span = '''                  <span>
                    {seconds} ثانية · {rps} طلب/ثانية
                  </span>'''
new_plan_span = '''                  <span>
                    {note || `${seconds} ثانية · ${rps} طلب/ثانية`}
                  </span>'''
if old_plan_span not in text:
    raise SystemExit('plan span not found')
text = text.replace(old_plan_span, new_plan_span, 1)

text = text.replace(
    '? "ملكية الموقع مؤكدة"',
    '? "ملكية الموقع مؤكدة · اختبارات غير محدودة"',
    1,
)
text = text.replace(
    '(samples.length / (chosen[2] * chosen[3])) * 100,',
    '(samples.length / expectedRequests) * 100,',
    1,
)
text = text.replace(
    '<p>{samples.length} طلب تم قياسه · اتصال واحد</p>',
    '<p>{samples.length} طلب تم قياسه · الهدف الحالي {currentRps} طلب/ثانية · اتصال واحد</p>',
    1,
)

old_assessment = '''                    {result.reason}{" "}
                    {result.failures === 0
                      ? "كرر الفحص بعد التعديلات الكبيرة."
                      : "شيّك سجلات الموقع وحدود الاستضافة وإعدادات الرابط."}'''
new_assessment = '''                    {result.reason}{" "}
                    {result.plan === "ramp" && (
                      <>
                        أعلى معدل مستقر تقريبي: <strong>{result.stableRps || "—"}</strong> طلب/ثانية.
                        {result.degradationRps
                          ? ` بداية التدهور ظهرت قرب ${result.degradationRps} طلب/ثانية.`
                          : " ما ظهرت نقطة تدهور ضمن النطاق المختبر."}
                      </>
                    )}
                    {result.plan !== "ramp" &&
                      (result.failures === 0
                        ? "كرر الفحص بعد التعديلات الكبيرة."
                        : "شيّك سجلات الموقع وحدود الاستضافة وإعدادات الرابط.")}'''
if old_assessment not in text:
    raise SystemExit('assessment block not found')
text = text.replace(old_assessment, new_assessment, 1)

text = text.replace(
    '"شغل الاختبار، راجع النتائج أو حمّل التقرير.",',
    '"اختر فحصًا ثابتًا أو تحملًا متدرجًا، راقب نقطة التدهور، ثم حمّل التقرير.",',
    1,
)
old_limits = '''                "HTTPS وموقع تثبت ملكيته",
                "حتى 3 طلبات/ثانية، باتصال واحد",
                "حتى 20 ثانية و60 طلب للاختبار",
                "إيقاف تلقائي عند 429 أو 503 أو 3 أخطاء متتالية",
                "عدد مرات الاختبار غير محدود، مع دقيقة انتظار بين اختبارات نفس الموقع",'''
new_limits = '''                "HTTPS وموقع تثبت ملكيته قبل أي اختبار حمل",
                "فحوص ثابتة + تحمل متدرج من 1 إلى 10 طلبات/ثانية",
                "حتى 30 ثانية و155 طلبًا في وضع التحمل المتدرج",
                "إيقاف تلقائي عند 429 أو 503 أو 3 أخطاء متتالية أو تدهور واضح",
                "بعد إثبات الملكية: عدد مرات التشغيل غير محدود، مع منع تشغيل اختبارين متزامنين لنفس الموقع",'''
if old_limits not in text:
    raise SystemExit('limits block not found')
text = text.replace(old_limits, new_limits, 1)
app.write_text(text)

tests = Path('tests/api.test.mjs')
text = tests.read_text()
old_once = '''  assert.equal(
    (await f.request("run", { id: c.id, plan: "quick" })).status,
    403,
  );'''
new_once = '''  const again = await f.request("run", { id: c.id, plan: "quick" });
  assert.equal(again.status, 200);
  await again.body.cancel();'''
pos1 = text.find(old_once)
pos2 = text.find(old_once, pos1 + 1)
if pos2 < 0:
    raise SystemExit('post-run single-use assertion not found')
text = text[:pos2] + new_once + text[pos2 + len(old_once):]

anchor = 'test("automatically stops on 429 after a single real request", async (t) => {'
ramp_test = '''test("ramp resilience mode is bounded and stops immediately on rate limiting", async (t) => {
  const f = await fixture(t, { status: 429 }),
    c = await f.setup(),
    r = await f.request("run", { id: c.id, plan: "ramp" }),
    events = (await r.text()).trim().split("\\n").map(JSON.parse),
    report = events.at(-1).result;
  assert.equal(f.count, 1);
  assert.equal(report.maxRps, 10);
  assert.equal(report.maxRequests, 155);
  assert.equal(report.samples[0].targetRps, 1);
  assert.equal(report.degradationRps, 1);
});
'''
if anchor not in text:
    raise SystemExit('test insertion anchor not found')
text = text.replace(anchor, ramp_test + anchor, 1)
tests.write_text(text)
