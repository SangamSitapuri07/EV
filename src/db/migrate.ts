import fs from "fs";
import path from "path";
import { getDbState } from "./index";

async function runMigrations() {
  const state = await getDbState();
  const migrationsDir = path.resolve(process.cwd(), "src/db/migrations");

  console.log(`[migrate] Running in ${state.mode} mode (PostGIS=${state.hasPostgis})`);

  const initSql = fs.readFileSync(path.join(migrationsDir, "0001_init.sql"), "utf-8");
  await state.rawExec(initSql);
  console.log("[migrate] Applied 0001_init.sql");

  const oauthSql = fs.readFileSync(path.join(migrationsDir, "0003_oauth_accounts.sql"), "utf-8");
  await state.rawExec(oauthSql);
  console.log("[migrate] Applied 0003_oauth_accounts.sql");

  const verifSql = fs.readFileSync(
    path.join(migrationsDir, "0004_ev_owner_verifications.sql"),
    "utf-8"
  );
  await state.rawExec(verifSql);
  console.log("[migrate] Applied 0004_ev_owner_verifications.sql");

  if (state.mode === "postgres" && process.env.ENABLE_POSTGIS === "true") {
    const postgisSql = fs.readFileSync(path.join(migrationsDir, "0002_postgis_prod.sql"), "utf-8");
    await state.rawExec(postgisSql);
    console.log("[migrate] Applied 0002_postgis_prod.sql");
  } else {
    console.log("[migrate] Skipped 0002_postgis_prod.sql (ENABLE_POSTGIS != true or PGlite dev mode)");
  }

  await state.close();
}

runMigrations().catch((err) => {
  console.error("[migrate] Failed:", err);
  process.exit(1);
});
