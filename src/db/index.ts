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
    const verifRows = await state.rawQuery<{ exists: boolean }>(
      `SELECT EXISTS (
         SELECT FROM information_schema.tables
         WHERE table_schema = 'public' AND table_name = 'ev_owner_verifications'
       ) AS exists`
    );
    if (!verifRows[0]?.exists) {
      const verifPath = path.resolve(
        process.cwd(),
        "src/db/migrations/0004_ev_owner_verifications.sql"
      );
      const verifSql = fs.readFileSync(verifPath, "utf-8");
      await state.rawExec(verifSql);
    }
    if (process.env.VITEST === "true" || process.env.SEED_SAMPLE_DATA === "true") {
      const { seedIfEmpty } = await import("./seed-data");
      await seedIfEmpty(state.db);
    } else {
      // Remove any previously auto-seeded sample/dummy records from older runs so only real data exists
      await purgeLeftoverSeedData(state);
      // Production / real mode: ensure pricing policy row exists without seeding any dummy data
      await state.db
        .insert(schema.platformSettings)
        .values({
          key: "pricing_policy",
          value: {
            platformFeeBps: 500,
            defaultTaxBps: 1800,
            holdTtlSeconds: 600,
            freeCancellationWindowMinutes: 30,
          },
        })
        .onConflictDoNothing();
    }
    globalForDb.__smartMobilitySeeded = true;
  }
  return state;
}

async function purgeLeftoverSeedData(state: DbState): Promise<void> {
  const check = await state.rawQuery<{ cnt: string | number }>(
    `SELECT (
       (SELECT COUNT(*) FROM facilities WHERE slug IN (
         'sarabha-nagar-central-plaza',
         'pau-gate-1-greencharge',
         'ferozepur-road-volt-superhub',
         'model-town-gol-market',
         'civil-lines-pavilion'
       ))
       +
       (SELECT COUNT(*) FROM users WHERE email LIKE '%@smartmobility.test')
     ) AS cnt`
  );
  const totalDummy = Number(check[0]?.cnt ?? 0);
  if (totalDummy === 0) return;

  await state.rawExec(`
    WITH dummy_users AS (
      SELECT id FROM users WHERE email LIKE '%@smartmobility.test'
    ),
    dummy_ops AS (
      SELECT id FROM operators
      WHERE owner_user_id IN (SELECT id FROM dummy_users)
         OR contact_email LIKE '%@smartmobility.test'
    ),
    dummy_facs AS (
      SELECT id FROM facilities
      WHERE slug IN (
        'sarabha-nagar-central-plaza',
        'pau-gate-1-greencharge',
        'ferozepur-road-volt-superhub',
        'model-town-gol-market',
        'civil-lines-pavilion'
      )
      OR operator_id IN (SELECT id FROM dummy_ops)
    ),
    dummy_res AS (
      SELECT id FROM reservations
      WHERE facility_id IN (SELECT id FROM dummy_facs)
         OR user_id IN (SELECT id FROM dummy_users)
    ),
    dummy_orders AS (
      SELECT id FROM payment_orders
      WHERE reservation_id IN (SELECT id FROM dummy_res)
         OR user_id IN (SELECT id FROM dummy_users)
    ),
    dummy_payments AS (
      SELECT id FROM payments
      WHERE reservation_id IN (SELECT id FROM dummy_res)
         OR payment_order_id IN (SELECT id FROM dummy_orders)
    )
    DELETE FROM refunds WHERE payment_id IN (SELECT id FROM dummy_payments) OR reservation_id IN (SELECT id FROM dummy_res);
    WITH dummy_users AS (SELECT id FROM users WHERE email LIKE '%@smartmobility.test'),
         dummy_ops AS (SELECT id FROM operators WHERE owner_user_id IN (SELECT id FROM dummy_users) OR contact_email LIKE '%@smartmobility.test'),
         dummy_facs AS (SELECT id FROM facilities WHERE slug IN ('sarabha-nagar-central-plaza','pau-gate-1-greencharge','ferozepur-road-volt-superhub','model-town-gol-market','civil-lines-pavilion') OR operator_id IN (SELECT id FROM dummy_ops)),
         dummy_res AS (SELECT id FROM reservations WHERE facility_id IN (SELECT id FROM dummy_facs) OR user_id IN (SELECT id FROM dummy_users))
    DELETE FROM payments WHERE reservation_id IN (SELECT id FROM dummy_res);
    WITH dummy_users AS (SELECT id FROM users WHERE email LIKE '%@smartmobility.test'),
         dummy_ops AS (SELECT id FROM operators WHERE owner_user_id IN (SELECT id FROM dummy_users) OR contact_email LIKE '%@smartmobility.test'),
         dummy_facs AS (SELECT id FROM facilities WHERE slug IN ('sarabha-nagar-central-plaza','pau-gate-1-greencharge','ferozepur-road-volt-superhub','model-town-gol-market','civil-lines-pavilion') OR operator_id IN (SELECT id FROM dummy_ops)),
         dummy_res AS (SELECT id FROM reservations WHERE facility_id IN (SELECT id FROM dummy_facs) OR user_id IN (SELECT id FROM dummy_users))
    DELETE FROM payment_orders WHERE reservation_id IN (SELECT id FROM dummy_res) OR user_id IN (SELECT id FROM dummy_users);
    WITH dummy_users AS (SELECT id FROM users WHERE email LIKE '%@smartmobility.test'),
         dummy_ops AS (SELECT id FROM operators WHERE owner_user_id IN (SELECT id FROM dummy_users) OR contact_email LIKE '%@smartmobility.test'),
         dummy_facs AS (SELECT id FROM facilities WHERE slug IN ('sarabha-nagar-central-plaza','pau-gate-1-greencharge','ferozepur-road-volt-superhub','model-town-gol-market','civil-lines-pavilion') OR operator_id IN (SELECT id FROM dummy_ops)),
         dummy_res AS (SELECT id FROM reservations WHERE facility_id IN (SELECT id FROM dummy_facs) OR user_id IN (SELECT id FROM dummy_users))
    DELETE FROM parking_sessions WHERE reservation_id IN (SELECT id FROM dummy_res) OR facility_id IN (SELECT id FROM dummy_facs) OR user_id IN (SELECT id FROM dummy_users);
    WITH dummy_users AS (SELECT id FROM users WHERE email LIKE '%@smartmobility.test'),
         dummy_ops AS (SELECT id FROM operators WHERE owner_user_id IN (SELECT id FROM dummy_users) OR contact_email LIKE '%@smartmobility.test'),
         dummy_facs AS (SELECT id FROM facilities WHERE slug IN ('sarabha-nagar-central-plaza','pau-gate-1-greencharge','ferozepur-road-volt-superhub','model-town-gol-market','civil-lines-pavilion') OR operator_id IN (SELECT id FROM dummy_ops)),
         dummy_res AS (SELECT id FROM reservations WHERE facility_id IN (SELECT id FROM dummy_facs) OR user_id IN (SELECT id FROM dummy_users))
    DELETE FROM charging_sessions WHERE reservation_id IN (SELECT id FROM dummy_res) OR facility_id IN (SELECT id FROM dummy_facs) OR user_id IN (SELECT id FROM dummy_users);
    WITH dummy_users AS (SELECT id FROM users WHERE email LIKE '%@smartmobility.test'),
         dummy_ops AS (SELECT id FROM operators WHERE owner_user_id IN (SELECT id FROM dummy_users) OR contact_email LIKE '%@smartmobility.test'),
         dummy_facs AS (SELECT id FROM facilities WHERE slug IN ('sarabha-nagar-central-plaza','pau-gate-1-greencharge','ferozepur-road-volt-superhub','model-town-gol-market','civil-lines-pavilion') OR operator_id IN (SELECT id FROM dummy_ops))
    DELETE FROM reservations WHERE facility_id IN (SELECT id FROM dummy_facs) OR user_id IN (SELECT id FROM dummy_users);
    WITH dummy_users AS (SELECT id FROM users WHERE email LIKE '%@smartmobility.test'),
         dummy_ops AS (SELECT id FROM operators WHERE owner_user_id IN (SELECT id FROM dummy_users) OR contact_email LIKE '%@smartmobility.test'),
         dummy_facs AS (SELECT id FROM facilities WHERE slug IN ('sarabha-nagar-central-plaza','pau-gate-1-greencharge','ferozepur-road-volt-superhub','model-town-gol-market','civil-lines-pavilion') OR operator_id IN (SELECT id FROM dummy_ops))
    DELETE FROM facilities WHERE id IN (SELECT id FROM dummy_facs);
    WITH dummy_users AS (SELECT id FROM users WHERE email LIKE '%@smartmobility.test')
    DELETE FROM operators WHERE owner_user_id IN (SELECT id FROM dummy_users) OR contact_email LIKE '%@smartmobility.test';
    UPDATE platform_settings SET updated_by_user_id = NULL
    WHERE updated_by_user_id IN (SELECT id FROM users WHERE email LIKE '%@smartmobility.test');
    DELETE FROM audit_logs WHERE actor_user_id IN (SELECT id FROM users WHERE email LIKE '%@smartmobility.test');
    DELETE FROM users WHERE email LIKE '%@smartmobility.test';
  `);
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
