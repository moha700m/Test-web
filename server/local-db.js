import { DatabaseSync } from "node:sqlite";
import { readFileSync, readdirSync, mkdirSync } from "node:fs";
export function localDb(file = ".sites-runtime/check.sqlite") {
  if (file !== ":memory:") mkdirSync(".sites-runtime", { recursive: true });
  const sqlite = new DatabaseSync(file);
  sqlite.exec(
    "PRAGMA journal_mode=WAL; CREATE TABLE IF NOT EXISTS _migrations(name TEXT PRIMARY KEY);",
  );
  for (const name of readdirSync(new URL("../drizzle/", import.meta.url))
    .filter((x) => x.endsWith(".sql"))
    .sort()) {
    if (!sqlite.prepare("SELECT 1 FROM _migrations WHERE name=?").get(name)) {
      sqlite.exec("BEGIN");
      try {
        sqlite.exec(
          readFileSync(new URL("../drizzle/" + name, import.meta.url), "utf8"),
        );
        sqlite.prepare("INSERT INTO _migrations(name) VALUES(?)").run(name);
        sqlite.exec("COMMIT");
      } catch (e) {
        sqlite.exec("ROLLBACK");
        throw e;
      }
    }
  }
  return {
    sqlite,
    prepare(sql) {
      return {
        bind(...args) {
          const stmt = sqlite.prepare(sql);
          return {
            first: async () => stmt.get(...args) || null,
            run: async () => ({
              meta: { changes: Number(stmt.run(...args).changes) },
            }),
          };
        },
      };
    },
  };
}
