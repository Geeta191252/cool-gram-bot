// One-time copy of the existing Lovable Cloud (Postgres) data into MongoDB.
// Usage:  SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... MONGODB_URI=... npm run migrate
import { getDb, closeDb } from "./mongo.js";

const TABLES = [
  "cg_users",
  "cg_ads",
  "cg_completions",
  "cg_transactions",
  "cg_boost_claims",
  "cg_settings",
  "cg_star_payments",
  "cg_withdrawals",
  "cg_cron_tokens",
];

const UNIQUE: Record<string, string[]> = {
  cg_users: ["tg_id"],
  cg_settings: ["key"],
  cg_boost_claims: ["ad_id", "tg_id"],
};

const PAGE = 1000;

async function fetchAll(table: string) {
  const url = process.env["SUPABASE_URL"];
  const key = process.env["SUPABASE_SERVICE_ROLE_KEY"];
  if (!url || !key) throw new Error("SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required");

  const rows: any[] = [];
  for (let from = 0; ; from += PAGE) {
    const res = await fetch(`${url}/rest/v1/${table}?select=*&limit=${PAGE}&offset=${from}`, {
      headers: { apikey: key, Authorization: `Bearer ${key}` },
    });
    if (!res.ok) throw new Error(`${table}: ${res.status} ${await res.text()}`);
    const batch = (await res.json()) as any[];
    rows.push(...batch);
    if (batch.length < PAGE) break;
  }
  return rows;
}

async function main() {
  const db = await getDb();

  for (const table of TABLES) {
    let rows: any[];
    try {
      rows = await fetchAll(table);
    } catch (err) {
      console.warn(`skip ${table}:`, (err as Error).message);
      continue;
    }
    if (!rows.length) {
      console.log(`${table}: 0 rows`);
      continue;
    }

    const col = db.collection(table);
    const keys = UNIQUE[table] ?? ["id"];
    let written = 0;
    for (const row of rows) {
      const filter: Record<string, any> = {};
      for (const k of keys) filter[k] = row[k];
      await col.updateOne(filter, { $set: row }, { upsert: true });
      written += 1;
    }
    console.log(`${table}: ${written} rows copied`);
  }

  await closeDb();
  console.log("Migration finished.");
}

main().catch(async (err) => {
  console.error(err);
  await closeDb();
  process.exit(1);
});
