import React, { useState } from "react";
import "@fortawesome/fontawesome-free/css/all.min.css";
const plans = [
  ["quick", "فحص سريع", 10, 1],
  ["light", "حمل خفيف", 20, 2],
  ["standard", "حمل محدود", 20, 3],
];
const Icon = ({ name }) => (
  <i className={`fa-solid fa-${name}`} aria-hidden="true" />
);
const ms = (n) => (n == null ? "—" : Math.round(n).toLocaleString("ar-SA"));
async function api(path, data) {
  const r = await fetch("/api/" + path, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data),
    }),
    d = await r.json();
  if (!r.ok) throw new Error(d.error || "تعذّر تنفيذ الطلب.");
  return d;
}
export function App() {
  const [url, setUrl] = useState(""),
    [plan, setPlan] = useState("quick"),
    [challenge, setChallenge] = useState(null),
    [verified, setVerified] = useState(false),
    [busy, setBusy] = useState(""),
    [error, setError] = useState(""),
    [message, setMessage] = useState(""),
    [samples, setSamples] = useState([]),
    [result, setResult] = useState(null),
    [job, setJob] = useState(null),
    [menu, setMenu] = useState(false);
  const chosen = plans.find((p) => p[0] === plan),
    metaTag = challenge
      ? `<meta name="site-check" content="${challenge.token}">`
      : "",
    prompt = challenge
      ? `أضف Meta Tag التالي داخل <head> في الصفحة الرئيسية لموقعي، بدون تغيير أي وظيفة أو تصميم:\n${metaTag}\nانشر التعديل بعد إضافته وتأكد أن الـ Meta Tag موجود في HTML المنشور.`
      : "";
  async function perform(action, fn) {
    setBusy(action);
    setError("");
    try {
      await fn();
    } catch (e) {
      setError(e.message || "تعذّر تنفيذ الطلب.");
    } finally {
      setBusy("");
    }
  }
  const prepare = () =>
    perform("prepare", async () => {
      const c = await api("challenge", { url });
      setChallenge(c);
      setUrl(c.url);
      setVerified(false);
      setResult(null);
      setSamples([]);
      setMessage("أضف Meta Tag للموقع، انشر التعديل، ثم اضغط «تحقق الآن».");
    });
  const verify = () =>
    perform("verify", async () => {
      await api("verify", { id: challenge.id });
      setVerified(true);
      setMessage("ملكية الموقع مؤكدة. تقدر تبدأ الاختبار.");
    });
  async function copy() {
    try {
      await navigator.clipboard.writeText(prompt);
      setMessage("تم نسخ البرومبت. أرسله لأداة بناء موقعك ثم انشر التعديل.");
    } catch {
      setMessage("حدد نص البرومبت وانسخه يدويًا.");
    }
  }
  const start = () =>
    perform("run", async () => {
      setSamples([]);
      setResult(null);
      setMessage("");
      const r = await fetch("/api/run", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: challenge.id, plan }),
      });
      if (!r.ok) throw new Error((await r.json()).error);
      let pending = "";
      const reader = r.body.getReader(),
        decoder = new TextDecoder();
      try {
        while (true) {
          const { value, done } = await reader.read();
          if (done) break;
          pending += decoder.decode(value, { stream: true });
          let index;
          while ((index = pending.indexOf("\n")) >= 0) {
            const line = pending.slice(0, index);
            pending = pending.slice(index + 1);
            if (!line) continue;
            const e = JSON.parse(line);
            if (e.type === "start") setJob(e.id);
            if (e.type === "sample") setSamples((s) => [...s, e.sample]);
            if (e.type === "done") {
              setResult(e.result);
              setVerified(false);
              setMessage(e.result.reason);
            }
            if (e.type === "error") throw new Error(e.error);
          }
        }
      } finally {
        setJob(null);
      }
    });
  async function stop() {
    try {
      await api("stop", { id: job });
      setMessage("طلب الإيقاف وصل. ينتهي الطلب الحالي خلال 4 ثوانٍ كحد أقصى.");
    } catch (e) {
      setError(e.message);
    }
  }
  function download() {
    const href = URL.createObjectURL(
        new Blob([JSON.stringify(result, null, 2)], {
          type: "application/json",
        }),
      ),
      a = document.createElement("a");
    a.href = href;
    a.download = "site-check-report.json";
    a.click();
    setTimeout(() => URL.revokeObjectURL(href), 1000);
  }
  const good = samples.filter((s) => s.ok),
    avg = good.length ? good.reduce((a, s) => a + s.ms, 0) / good.length : null;
  return (
    <>
      <header>
        <div className="container nav">
          <a href="#home" className="brand">
            <Icon name="flask-vial" />
            <span>
              اختبر <em>موقعك</em>
            </span>
          </a>
          <button
            className="menu"
            onClick={() => setMenu(!menu)}
            aria-label="فتح القائمة"
            aria-expanded={menu}
          >
            <Icon name={menu ? "xmark" : "bars"} />
          </button>
          <nav className={menu ? "open" : ""}>
            <a href="#test" onClick={() => setMenu(false)}>
              الاختبار
            </a>
            <a href="#how" onClick={() => setMenu(false)}>
              كيف يشتغل
            </a>
            <a href="#limits" onClick={() => setMenu(false)}>
              حدود الاختبار
            </a>
            <small>MOHAMMED LAB</small>
          </nav>
        </div>
      </header>
      <main id="home">
        <section className="hero container">
          <div className="eyebrow">لمواقعك اللي تبنيها بالفايب كودنق</div>
          <h1>
            بنيت موقعك؟ <em>اختبره.</em>
          </h1>
          <p className="lead">
            وقت الاستجابة، الطلبات الناجحة، والأخطاء.
            <br />
            نتائج حقيقية من اختبارات قصيرة ومحدودة.
          </p>
          <section className="panel" id="test" aria-label="تجهيز اختبار الموقع">
            <div className="panel-heading">
              <div>
                <h2>ابدأ برابط موقعك</h2>
                <p>أثبت الملكية، واختر الحمل، وشوف النتيجة.</p>
              </div>
              <Icon name="gauge-high" />
            </div>
            <form
              onSubmit={(e) => {
                e.preventDefault();
                prepare();
              }}
            >
              <div className="input-wrap">
                <Icon name="link" />
                <input
                  aria-label="رابط الموقع"
                  type="url"
                  dir="ltr"
                  value={url}
                  placeholder="https://www.example.com"
                  onChange={(e) => {
                    setUrl(e.target.value);
                    setChallenge(null);
                    setVerified(false);
                    setError("");
                  }}
                  required
                  disabled={!!busy}
                />
              </div>
              <button className="primary" disabled={!!busy}>
                {busy === "prepare" ? "جاري التجهيز…" : "جهّز الاختبار"}
              </button>
            </form>
            <p className="platforms">
              يدعم أي دومين HTTPS عام تملكه، وعدد مرات الاختبار غير محدود. كل تشغيل يبقى ضمن حدود حمل آمنة.
            </p>
            <div className="plans" role="radiogroup" aria-label="نوع الاختبار">
              {plans.map(([id, label, seconds, rps]) => (
                <button
                  key={id}
                  className={"plan " + (plan === id ? "selected" : "")}
                  role="radio"
                  aria-checked={plan === id}
                  disabled={busy === "run"}
                  onClick={() => setPlan(id)}
                >
                  <strong>{label}</strong>
                  <span>
                    {seconds} ثانية · {rps} طلب/ثانية
                  </span>
                </button>
              ))}
            </div>
            {challenge && (
              <div className="ownership">
                <h3>
                  <Icon name={verified ? "circle-check" : "shield-halved"} />{" "}
                  {verified
                    ? "ملكية الموقع مؤكدة"
                    : "خطوة واحدة لإثبات الملكية"}
                </h3>
                {!verified && (
                  <>
                    <p>
                      الأسرع الآن: أرسل البرومبت لأداة بناء موقعك. تضيف سطرًا واحدًا داخل <code>&lt;head&gt;</code> وتنشره.
                    </p>
                    <div
                      dir="ltr"
                      style={{
                        padding: "14px 16px",
                        border: "1px solid #353d4f",
                        borderRadius: 5,
                        background: "#080e1b",
                        color: "#dfe3ec",
                        overflowX: "auto",
                        fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
                        fontSize: 13,
                        whiteSpace: "nowrap",
                      }}
                    >
                      {metaTag}
                    </div>
                    <div className="actions">
                      <button className="secondary" onClick={copy}>
                        <Icon name="copy" /> نسخ لأداة البناء
                      </button>
                      <button
                        className="primary"
                        onClick={verify}
                        disabled={!!busy}
                      >
                        {busy === "verify" ? "جاري التحقق…" : "تحقق الآن"}
                      </button>
                    </div>
                    <details style={{ marginTop: 14, color: "#8d94a3", fontSize: 13 }}>
                      <summary style={{ cursor: "pointer" }}>طريقة بديلة للمشاريع القديمة</summary>
                      <p style={{ marginTop: 10 }}>
                        ما زال بإمكانك استخدام ملف <code dir="ltr">/.well-known/site-check.txt</code> بنفس رمز التحقق.
                      </p>
                      <a
                        className="proof"
                        href={challenge.proofUrl}
                        target="_blank"
                        rel="noreferrer"
                      >
                        افتح رابط الملف الاحتياطي <Icon name="up-right-from-square" />
                      </a>
                    </details>
                  </>
                )}
                {verified && busy !== "run" && (
                  <button
                    className="primary wide"
                    onClick={start}
                    disabled={!!busy}
                  >
                    <Icon name="play" /> ابدأ {chosen[1]}
                  </button>
                )}
              </div>
            )}
            {error && (
              <p role="alert" className="error">
                <Icon name="circle-exclamation" /> {error}
              </p>
            )}
            {message && (
              <p role="status" className="message">
                {message}
              </p>
            )}
            {busy === "run" && (
              <div className="running">
                <div>
                  <strong>
                    <Icon name="spinner" /> الاختبار شغال
                  </strong>
                  <button className="stop" onClick={stop} disabled={!job}>
                    <Icon name="stop" /> إيقاف
                  </button>
                </div>
                <progress
                  max="100"
                  value={Math.min(
                    99,
                    (samples.length / (chosen[2] * chosen[3])) * 100,
                  )}
                />
                <p>{samples.length} طلب تم قياسه · اتصال واحد</p>
              </div>
            )}
          </section>
        </section>
        {(samples.length > 0 || result) && (
          <section className="container results">
            <div className="results-heading">
              <h2>
                نتائج <em>الاختبار</em>
              </h2>
              {result && (
                <button className="secondary" onClick={download}>
                  <Icon name="download" /> تحميل التقرير
                </button>
              )}
            </div>
            <div className="metrics">
              {[
                ["متوسط الاستجابة", ms(result?.avg ?? avg), "ms"],
                ["95% من الطلبات أسرع من", ms(result?.p95), "ms"],
                [
                  "نسبة النجاح",
                  samples.length
                    ? Math.round((good.length / samples.length) * 100)
                    : "—",
                  "%",
                ],
                ["الطلبات المنفذة", samples.length, ""],
              ].map(([label, value, unit]) => (
                <article key={label}>
                  <span>{label}</span>
                  <strong>
                    {value} <small>{unit}</small>
                  </strong>
                </article>
              ))}
            </div>
            <div className="chart">
              <h3>وقت الاستجابة لكل طلب</h3>
              <div className="bars" dir="ltr">
                {samples.map((s, i) => (
                  <div
                    key={i}
                    className={"bar " + (s.ok ? "" : "failed")}
                    style={{
                      height:
                        Math.max(
                          5,
                          (s.ms / Math.max(1, ...samples.map((x) => x.ms))) *
                            130,
                        ) + "px",
                    }}
                    title={`#${i + 1} · ${s.ms} ms · HTTP ${s.status}`}
                    aria-label={`طلب ${i + 1}، ${ms(s.ms)} مللي ثانية`}
                  />
                ))}
              </div>
              <p>
                القياس لزمن وصول ترويسات الاستجابة من سيرفر الفحص، مو سرعة جهاز
                المستخدم أو سعة الموقع القصوى.
              </p>
            </div>
            {result && (
              <div className="assessment">
                <Icon name="clipboard-check" />
                <div>
                  <h3>
                    {result.failures === 0
                      ? "استجابة مستقرة خلال هذا الاختبار"
                      : "ظهرت أخطاء تحتاج مراجعة"}
                  </h3>
                  <p>
                    {result.reason}{" "}
                    {result.failures === 0
                      ? "كرر الفحص بعد التعديلات الكبيرة."
                      : "شيّك سجلات الموقع وحدود الاستضافة وإعدادات الرابط."}
                  </p>
                </div>
              </div>
            )}
            <div className="table-wrap">
              <table>
                <caption>آخر الطلبات</caption>
                <thead>
                  <tr>
                    <th>الطلب</th>
                    <th>حالة HTTP</th>
                    <th>الوقت</th>
                    <th>النتيجة</th>
                  </tr>
                </thead>
                <tbody>
                  {samples
                    .slice(-8)
                    .reverse()
                    .map((s, i) => (
                      <tr key={i}>
                        <td>#{samples.length - i}</td>
                        <td>{s.status || "—"}</td>
                        <td>{ms(s.ms)} ms</td>
                        <td className={s.ok ? "good" : "bad"}>
                          {s.ok ? "ناجح" : s.error}
                        </td>
                      </tr>
                    ))}
                </tbody>
              </table>
            </div>
          </section>
        )}
        <section className="container how" id="how">
          <h2>
            كيف <em>يشتغل؟</em>
          </h2>
          <div className="info-grid">
            {[
              [
                "link",
                "حط الرابط",
                "ابدأ برابط موقعك المنشور على الإنترنت، سواء دومين خاص أو رابط منصة استضافة.",
              ],
              [
                "shield-halved",
                "أثبت الملكية",
                "انسخ البرومبت لأداة البناء؛ تضيف Meta Tag واحدًا ثم تنشر التعديل.",
              ],
              [
                "chart-line",
                "خذ النتيجة",
                "شغل الاختبار، راجع النتائج أو حمّل التقرير.",
              ],
            ].map(([icon, title, text], i) => (
              <article key={title}>
                <div className="info-icon">
                  <Icon name={icon} />
                </div>
                <small>0{i + 1}</small>
                <h3>{title}</h3>
                <p>{text}</p>
              </article>
            ))}
          </div>
        </section>
        <section className="limits" id="limits">
          <div className="container limits-inner">
            <div>
              <div className="eyebrow">اختبارات محسوبة</div>
              <h2>
                اختبر الأداء.
                <br />
                <em>وحافظ على موقعك.</em>
              </h2>
            </div>
            <ul>
              {[
                "HTTPS وموقع تثبت ملكيته",
                "حتى 3 طلبات/ثانية، باتصال واحد",
                "حتى 20 ثانية و60 طلب للاختبار",
                "إيقاف تلقائي عند 429 أو 503 أو 3 أخطاء متتالية",
                "عدد مرات الاختبار غير محدود، مع دقيقة انتظار بين اختبارات نفس الموقع",
              ].map((t) => (
                <li key={t}>
                  <Icon name="check" /> {t}
                </li>
              ))}
            </ul>
          </div>
        </section>
      </main>
      <footer className="container">
        <small>MOHAMMED LAB</small>
        <p>اختبر موقعك · قياسات فعلية لا تقدّر السعة القصوى من اختبار قصير.</p>
      </footer>
    </>
  );
}
