import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { localDb } from "./local-db.js";
import { apiMiddleware } from "./middleware.js";
const api = apiMiddleware(localDb()),
  root = path.resolve("dist/client"),
  types = {
    ".html": "text/html; charset=utf-8",
    ".js": "text/javascript",
    ".css": "text/css",
    ".svg": "image/svg+xml",
    ".woff2": "font/woff2",
    ".woff": "font/woff",
    ".ttf": "font/ttf",
    ".json": "application/json",
  };
createServer((req, res) =>
  api(req, res, async () => {
    try {
      if (req.url.startsWith("/api/")) {
        res.writeHead(404);
        return res.end();
      }
      let file = path.resolve(
        root,
        "." + decodeURIComponent(new URL(req.url, "http://local").pathname),
      );
      if (file !== root && !file.startsWith(root + path.sep)) {
        res.writeHead(403);
        return res.end();
      }
      if (path.extname(file) === "") file = path.join(root, "index.html");
      const data = await readFile(file);
      res.writeHead(200, {
        "Content-Type": types[path.extname(file)] || "application/octet-stream",
        "X-Content-Type-Options": "nosniff",
      });
      res.end(data);
    } catch {
      res.writeHead(404);
      res.end("Not found");
    }
  }),
).listen(Number(process.env.PORT || 3000), "127.0.0.1", () =>
  console.log(
    "اختبر موقعك: http://127.0.0.1:" + Number(process.env.PORT || 3000),
  ),
);
