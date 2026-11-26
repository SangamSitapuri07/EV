import { drizzle as drizzlePg, type NodePgDatabase } from "drizzle-orm/node-postgres";
import { drizzle as drizzlePglite, type PgliteDatabase } from "drizzle-orm/pglite";
import { Pool } from "pg";
import { PGlite } from "@electric-sql/pglite";
import path from "path";
import fs from "fs";
import * as schema from "./schema";

export type AppDb = NodePgDatabase<typeof schema> | PgliteDatabase<typeof schema>;

interface DbState {
  db: AppDb;
  mode: "postgres" | "pglite";
  hasPostgis: boolean;
  rawExec: (sql: string) => Promise<void>;
  rawQuery: <T = Record<string, unknown>>(sql: string, params?: unknown[]) => Promise<T[]>;
  close: () => Promise<void>;
}

const globalForDb = globalThis as unknown as {
  __smartMobilityDbPromise?: Promise<DbState>;
  __smartMobilitySeeded?: boolean;
};

async function initDb(): Promise<DbState> {
  const databaseUrl = process.env.DATABASE_URL ?? "pglite://.data/pgdata";
  const enablePostgis = process.env.ENABLE_POSTGIS === "true";

  if (databaseUrl.startsWith("postgres://") || databaseUrl.startsWith("postgresql://")) {
    const pool = new Pool({
      connectionString: databaseUrl,
      max: Number(process.env.PG_POOL_MAX ?? 15),
    });
    const db = drizzlePg(pool, { schema });

    let hasPostgis = false;
    if (enablePostgis) {
      try {
        const res = await pool.query(
          "SELECT EXISTS(SELECT 1 FROM pg_extension WHERE extname = 'postgis') AS exists"
        );
        hasPostgis = Boolean(res.rows[0]?.exists);
      } catch {
        hasPostgis = false;
      }
    }

    return {
      db,
      mode: "postgres",
      hasPostgis,
      rawExec: async (sql: string) => {
        await pool.query(sql);
      },
      rawQuery: async <T = Record<string, unknown>>(sql: string, params: unknown[] = []) => {
        const res = await pool.query(sql, params);
        return res.rows as T[];
      },
      close: async () => {
        await pool.end();
      },
    };
  }

  // Embedded PostgreSQL (PGlite) zero-dependency mode
  const isMemory = databaseUrl === "pglite://memory" || process.env.NODE_ENV === "test";
  let pglite: PGlite;
  if (isMemory && databaseUrl === "pglite://memory") {
    pglite = new PGlite();
  } else {
    const relPath = databaseUrl.replace(/^pglite:\/\//, "") || ".data/pgdata";
    const absPath = path.isAbsolute(relPath)
      ? relPath
      : path.join(/*turbopackIgnore: true*/ process.cwd(), ".data", path.basename(relPath));
    fs.mkdirSync(path.dirname(absPath), { recursive: true });
    pglite = new PGlite(absPath);
  }
  await pglite.waitReady;

  const db = drizzlePglite(pglite, { schema });

  return {
    db,
    mode: "pglite",
    hasPostgis: false,
    rawExec: async (sql: string) => {
      await pglite.exec(sql);
    },
    rawQuery: async <T = Record<string, unknown>>(sql: string, params: unknown[] = []) => {
      const res = await pglite.query<T>(sql, params);
      return res.rows;
    },
    close: async () => {
      await pglite.close();
    },
  };
}

export async function getDbState(): Promise<DbState> {
  if (!globalForDb.__smartMobilityDbPromise) {
    globalForDb.__smartMobilityDbPromise = initDb();
  }
  return globalForDb.__smartMobilityDbPromise;
}

export async function getDb(): Promise<AppDb> {
  const state = await getDbState();
  return state.db;
}

export async function ensureDatabaseReady(): Promise<DbState> {
  const state = await getDbState();
  if (!globalForDb.__smartMobilitySeeded) {
    // Check if users table exists; if not, run 0001_init.sql and seed
    const rows = await state.rawQuery<{ exists: boolean }>(
      `SELECT EXISTS (
         SELECT FROM information_schema.tables
         WHERE table_schema = 'public' AND table_name = 'users'
       ) AS exists`
    );
    if (!rows[0]?.exists) {
      const migrationPath = path.resolve(process.cwd(), "src/db/migrations/0001_init.sql");
      const sql = fs.readFileSync(migrationPath, "utf-8");
      await state.rawExec(sql);
    }
    // Ensure OAuth accounts table exists even on previously initialized local DBs
    const oauthRows = await state.rawQuery<{ exists: boolean }>(
      `SELECT EXISTS (
         SELECT FROM information_schema.tables
         WHERE table_schema = 'public' AND table_name = 'oauth_accounts'
       ) AS exists`
    );
    if (!oauthRows[0]?.exists) {
      const oauthPath = path.resolve(
        process.cwd(),
        "src/db/migrations/0003_oauth_accounts.sql"
      );
      const oauthSql = fs.readFileSync(oauthPath, "utf-8");
      await state.rawExec(oauthSql);
    }
    const { seedIfEmpty } = await import("./seed-data");
    await seedIfEmpty(state.db);
    globalForDb.__smartMobilitySeeded = true;
  }
  return state;
}

export async function resetDbForTests(): Promise<void> {
  if (globalForDb.__smartMobilityDbPromise) {
    const state = await globalForDb.__smartMobilityDbPromise;
    await state.close();
    globalForDb.__smartMobilityDbPromise = undefined;
    globalForDb.__smartMobilitySeeded = false;
  }
}

export { schema };
