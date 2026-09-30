import { Readable } from "node:stream";
import { handleApi } from "../worker/api.js";
export function apiMiddleware(db) {
  return async (req, res, next) => {
    if (!req.url?.startsWith("/api/")) return next();
    const origin = process.env.PUBLIC_ORIGIN || "http://" + req.headers.host,
      controller = new AbortController();
    res.on("close", () => {
      if (!res.writableEnded) controller.abort();
    });
    try {
      const request = new Request(new URL(req.url, origin), {
        method: req.method,
        headers: req.headers,
        body: ["GET", "HEAD"].includes(req.method)
          ? undefined
          : Readable.toWeb(req),
        duplex: "half",
        signal: controller.signal,
      });
      const response = await handleApi(request, {
        DB: db,
      });
      if (!response) return next();
      res.writeHead(response.status, Object.fromEntries(response.headers));
      if (response.body) Readable.fromWeb(response.body).pipe(res);
      else res.end();
    } catch (e) {
      console.error(e.message);
      if (!res.headersSent) {
        res.writeHead(500, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "تعذر تنفيذ الطلب." }));
      } else res.end();
    }
  };
}
