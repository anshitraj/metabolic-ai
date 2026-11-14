import "server-only";
import path from "node:path";
import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core";
import * as schema from "./schema";

// PostgreSQL when DATABASE_URL is set; otherwise an embedded PGlite database in
// .data/pglite so the app runs locally with no setup. Migrations run once on
// first use. Production should always set DATABASE_URL.

export type Db = PgDatabase<PgQueryResultHKT, typeof schema>;

const MIGRATIONS = path.join(process.cwd(), "server", "db", "migrations");

type GlobalDb = { __metabolicDb?: Promise<Db> };
const g = globalThis as unknown as GlobalDb;

async function connect(): Promise<Db> {
  const url = process.env.DATABASE_URL?.trim();
  if (url) {
    const { default: postgres } = await import("postgres");
    const { drizzle } = await import("drizzle-orm/postgres-js");
    const { migrate } = await import("drizzle-orm/postgres-js/migrator");
    const client = postgres(url, { max: Number(process.env.DATABASE_POOL_MAX ?? 10) });
    const db = drizzle(client, { schema });
    await migrate(db, { migrationsFolder: MIGRATIONS });
    return db as unknown as Db;
  }
  const { PGlite } = await import("@electric-sql/pglite");
  const { drizzle } = await import("drizzle-orm/pglite");
  const { migrate } = await import("drizzle-orm/pglite/migrator");
  const dir = process.env.PGLITE_DIR ?? path.join(process.cwd(), ".data", "pglite");
  if (dir !== "memory") {
    const { mkdirSync } = await import("node:fs");
    mkdirSync(path.dirname(dir), { recursive: true });
  }
  const client = dir === "memory" ? new PGlite() : new PGlite(dir);
  const db = drizzle(client, { schema });
  await migrate(db, { migrationsFolder: MIGRATIONS });
  return db as unknown as Db;
}

export function getDb(): Promise<Db> {
  if (!g.__metabolicDb) {
    g.__metabolicDb = connect().catch((err) => {
      g.__metabolicDb = undefined;
      throw err;
    });
  }
  return g.__metabolicDb;
}

/** The transaction handle type for `db.transaction(async (tx) => …)`. */
export type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];
export type Executor = Db | Tx;
export { schema };
