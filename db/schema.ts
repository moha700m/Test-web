import { sqliteTable, text, integer } from "drizzle-orm/sqlite-core";
export const challenges = sqliteTable("challenges", {
  id: text("id").primaryKey(),
  session: text("session").notNull(),
  origin: text("origin").notNull(),
  url: text("url").notNull(),
  token: text("token").notNull(),
  expires: integer("expires").notNull(),
  verified: integer("verified").notNull().default(0),
  used: integer("used").notNull().default(0),
  attempts: integer("attempts").notNull().default(0),
});
export const hosts = sqliteTable("hosts", {
  origin: text("origin").primaryKey(),
  verifyAt: integer("verify_at").notNull().default(0),
  lastStarted: integer("last_started").notNull().default(0),
  lockedUntil: integer("locked_until").notNull().default(0),
  runId: text("run_id"),
});
export const runs = sqliteTable("runs", {
  id: text("id").primaryKey(),
  session: text("session").notNull(),
  origin: text("origin").notNull(),
  started: integer("started").notNull(),
  stopped: integer("stopped").notNull().default(0),
  finished: integer("finished").notNull().default(0),
  result: text("result"),
});
