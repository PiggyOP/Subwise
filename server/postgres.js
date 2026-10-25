import { AsyncLocalStorage } from "node:async_hooks";
import pg from "pg";

// Millisecond timestamps and provider sequences must survive PostgreSQL BIGINT reads.
pg.types.setTypeParser(20, (value) => {
  const number = Number(value);
  if (!Number.isSafeInteger(number))
    throw Error("Database integer is out of range");
  return number;
});

// The application uses a small, fixed SQL dialect. Preserve quoted text while
// adapting its placeholders and numeric column types for PostgreSQL.
export function postgresSQL(sql) {
  let index = 0;
  const ignore = /^\s*INSERT OR IGNORE\b/i.test(sql);
  sql = sql.replace(/^\s*INSERT OR IGNORE\b/i, "INSERT");
  sql = sql.replace(
    /('(?:''|[^'])*'|"(?:""|[^"])*"|--[^\n]*|\/\*[\s\S]*?\*\/)|\?|\bINTEGER\b|\bREAL\b/gi,
    (token, quoted) =>
      quoted ||
      (token === "?"
        ? `$${++index}`
        : token.toUpperCase() === "INTEGER"
          ? "BIGINT"
          : "DOUBLE PRECISION"),
  );
  sql = sql.replace(
    /ADD COLUMN (?!IF NOT EXISTS)/gi,
    "ADD COLUMN IF NOT EXISTS ",
  );
  if (ignore) sql = sql.replace(/;?\s*$/, " ON CONFLICT DO NOTHING");
  return sql;
}

export function createPostgresDatabase(pool) {
  const contexts = new AsyncLocalStorage();
  async function cleanup(context) {
    const client = context.client;
    context.client = null;
    if (client) {
      let broken = false;
      try {
        await client.query("ROLLBACK");
      } catch {
        broken = true;
      }
      client.release(broken);
    }
  }
  function assertOpen(context) {
    if (context?.closed) throw Error("Database context is closed");
  }
  async function query(sql, values = []) {
    const context = contexts.getStore();
    assertOpen(context);
    const pragma = /^\s*PRAGMA table_info\((\w+)\)/i.exec(sql);
    if (pragma)
      return (context?.client || pool).query(
        "SELECT column_name AS name FROM information_schema.columns WHERE table_schema=current_schema() AND table_name=$1",
        [pragma[1]],
      );
    return (context?.client || pool).query(postgresSQL(sql), values);
  }
  const database = {
    prepare(sql) {
      return {
        async get(...values) {
          return (await query(sql, values)).rows[0];
        },
        async all(...values) {
          return (await query(sql, values)).rows;
        },
        async run(...values) {
          return { changes: (await query(sql, values)).rowCount };
        },
      };
    },
    async exec(sql) {
      const context = contexts.getStore();
      if (/^\s*BEGIN(?: IMMEDIATE)?\s*;?\s*$/i.test(sql)) {
        assertOpen(context);
        if (!context || context.client)
          throw Error("Transaction requires an isolated database context");
        const client = await pool.connect();
        if (context.closed) {
          client.release();
          throw Error("Database context is closed");
        }
        context.client = client;
        try {
          await client.query("BEGIN");
        } catch (error) {
          await cleanup(context);
          throw error;
        }
        return;
      }
      if (/^\s*(COMMIT|ROLLBACK)\s*;?\s*$/i.test(sql)) {
        if (!context?.client) throw Error("No database transaction is active");
        const client = context.client;
        if (/ROLLBACK/i.test(sql)) return cleanup(context);
        try {
          await client.query("COMMIT");
          context.client = null;
          client.release();
        } catch (error) {
          await cleanup(context);
          throw error;
        }
        return;
      }
      sql = sql
        .replace(/PRAGMA (?:journal_mode=WAL|foreign_keys=ON)\s*;/gi, "")
        .trim();
      if (!sql) return;
      // Cold starts may initialize the same schema concurrently. Serialize DDL
      // across instances, not just across requests in one function process.
      if (
        /\b(?:CREATE TABLE|CREATE (?:UNIQUE )?INDEX|ALTER TABLE)\b/i.test(sql)
      ) {
        const client = await pool.connect();
        try {
          await client.query("BEGIN");
          await client.query("SELECT pg_advisory_xact_lock(1937072759)");
          await client.query(postgresSQL(sql));
          await client.query("COMMIT");
        } catch (error) {
          await client.query("ROLLBACK").catch(() => {});
          throw error;
        } finally {
          client.release();
        }
        return;
      }
      await query(sql);
    },
    close: () => pool.end(),
    withContext: (task) =>
      contexts.run({ client: null, closed: false }, async () => {
        const context = contexts.getStore();
        try {
          return await task();
        } finally {
          context.closed = true;
          await cleanup(context);
        }
      }),
    middleware(req, res, next) {
      contexts.run({ client: null, closed: false }, () => {
        const context = contexts.getStore();
        const done = () => {
          if (context.closed) return;
          context.closed = true;
          cleanup(context).catch(() =>
            console.error("Database cleanup failed"),
          );
        };
        res.once("finish", done);
        res.once("close", done);
        next();
      });
    },
  };
  return database;
}

export async function openPostgresDatabase() {
  const connectionString =
    process.env.DATABASE_URL ||
    (await import("@netlify/database")).getConnectionString();
  const pool = new pg.Pool({
    connectionString,
    max: 3,
    connectionTimeoutMillis: 15000,
    idleTimeoutMillis: 10000,
    query_timeout: 10000,
    statement_timeout: 10000,
    allowExitOnIdle: true,
  });
  pool.on("error", () => console.error("Database connection interrupted"));
  return createPostgresDatabase(pool);
}
