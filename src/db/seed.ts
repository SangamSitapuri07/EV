import { ensureDatabaseReady } from "./index";

async function main() {
  const state = await ensureDatabaseReady();
  console.log(`[seed] Database ready (${state.mode}). Seed check completed.`);
  await state.close();
}

main().catch((err) => {
  console.error("[seed] Failed:", err);
  process.exit(1);
});
