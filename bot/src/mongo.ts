// Minimal Mongo-backed replacement for the Supabase query builder used by the bot.
// Only the subset of the PostgREST API the bot relies on is implemented.
import { MongoClient, type Db, type Collection } from "mongodb";
import { randomUUID } from "crypto";

const UNIQUE: Record<string, string[]> = {
  cg_users: ["tg_id"],
  cg_telegram_updates: ["update_id"],
  cg_settings: ["key"],
  cg_boost_claims: ["ad_id", "tg_id"],
  cg_proofs: ["ad_id", "tg_id"],
  cg_bot_chats: ["chat_id"],
};

type DefaultMap = Record<string, unknown | (() => unknown)>;

const DEFAULTS: Record<string, DefaultMap> = {
  cg_users: {
    balance: 0,
    referral_count: 0,
    first_name: null,
    username: null,
    pending_action: null,
    referred_by: null,
    ref_paid: false,
  },
  cg_ads: {
    reward: 5,
    budget_left: 0,
    is_active: true,
    category: "channels",
    subtype: null,
    src_chat: null,
    src_msg: null,
    boost_days: null,
  },
  cg_boost_claims: {
    days_claimed: 0,
    total_days: 7,
    status: "active",
    reminded_at: null,
    last_claim_at: () => new Date().toISOString(),
  },
  cg_withdrawals: { status: "pending", username: null, resolved_at: null },
  cg_star_payments: { charge_id: null, username: null },
  cg_proofs: { status: "pending", file_id: null, resolved_at: null },
  cg_completions: {},
  cg_transactions: {},
  cg_settings: {},
  cg_telegram_updates: {},
  cg_cron_tokens: {},
  cg_bot_chats: { title: null, username: null, type: null, status: "administrator", added_by: null },
};

let client: MongoClient | undefined;
let dbPromise: Promise<Db> | undefined;

export function getDb(): Promise<Db> {
  if (!dbPromise) {
    const uri = process.env["MONGODB_URI"];
    if (!uri) throw new Error("MONGODB_URI is not configured");
    client = new MongoClient(uri, {
      maxPoolSize: 50,
      minPoolSize: 5,
      maxIdleTimeMS: 300_000,
      serverSelectionTimeoutMS: 8_000,
      compressors: ["zlib"],
    });
    dbPromise = client
      .connect()
      .then(async (c) => {
        const db = c.db(process.env["MONGODB_DB"] ?? "coolgram");
        await ensureIndexes(db);
        return db;
      })
      .catch((err) => {
        dbPromise = undefined;
        throw err;
      });
  }
  return dbPromise;
}

async function ensureIndexes(db: Db) {
  for (const [table, keys] of Object.entries(UNIQUE)) {
    const spec: Record<string, 1> = {};
    for (const k of keys) spec[k] = 1;
    await db
      .collection(table)
      .createIndex(spec, { unique: true })
      .catch(() => undefined);
  }
  await db.collection("cg_ads").createIndex({ is_active: 1, category: 1 }).catch(() => undefined);
  await db.collection("cg_ads").createIndex({ owner_tg: 1 }).catch(() => undefined);
  await db.collection("cg_completions").createIndex({ tg_id: 1 }).catch(() => undefined);
  await db.collection("cg_completions").createIndex({ ad_id: 1, tg_id: 1 }).catch(() => undefined);
  await db.collection("cg_proofs").createIndex({ tg_id: 1 }).catch(() => undefined);
  await db.collection("cg_proofs").createIndex({ status: 1, created_at: 1 }).catch(() => undefined);
  await db.collection("cg_boost_claims").createIndex({ status: 1, last_claim_at: 1 }).catch(() => undefined);
  await db.collection("cg_withdrawals").createIndex({ status: 1, created_at: -1 }).catch(() => undefined);
  await db
    .collection("cg_transactions")
    .createIndex({ tg_id: 1, created_at: -1 })
    .catch(() => undefined);
  await db
    .collection("cg_telegram_updates")
    .createIndex({ created_at: 1 }, { expireAfterSeconds: 86400 })
    .catch(() => undefined);
}

function applyDefaults(table: string, doc: Record<string, any>) {
  const out: Record<string, any> = { ...doc };
  const defs = DEFAULTS[table] ?? {};
  for (const [key, val] of Object.entries(defs)) {
    if (out[key] === undefined) out[key] = typeof val === "function" ? (val as () => unknown)() : val;
  }
  if (table !== "cg_settings" && table !== "cg_telegram_updates" && out["id"] === undefined) {
    out["id"] = randomUUID();
  }
  if (out["created_at"] === undefined) out["created_at"] = new Date().toISOString();
  return out;
}

function parseValue(raw: string): unknown {
  if (raw === "null") return null;
  if (raw === "true") return true;
  if (raw === "false") return false;
  if (raw !== "" && !Number.isNaN(Number(raw))) return Number(raw);
  return raw;
}

type Result<T = any> = { data: T; error: { message: string } | null; count?: number };

class QueryBuilder implements PromiseLike<Result> {
  private conditions: Record<string, any>[] = [];
  private op: "select" | "insert" | "update" | "upsert" | "delete" = "select";
  private payload: any = null;
  private sortSpec: Record<string, 1 | -1> | undefined;
  private limitN: number | undefined;
  private rowMode: "many" | "single" | "maybe" = "many";
  private wantRows = false;
  private headMode = false;
  private countMode = false;
  private projection: Record<string, 1> | undefined;

  constructor(private table: string) {}

  select(columns?: string, opts?: { count?: string; head?: boolean }) {
    if (this.op === "select") {
      if (opts?.count) this.countMode = true;
      if (opts?.head) this.headMode = true;
      if (columns && !columns.includes("*") && !columns.includes("(")) {
        const spec: Record<string, 1> = {};
        for (const c of columns.split(",")) {
          const name = c.trim();
          if (name) spec[name] = 1;
        }
        if (Object.keys(spec).length) this.projection = spec;
      }
    }
    this.wantRows = true;
    return this;
  }

  insert(payload: any) {
    this.op = "insert";
    this.payload = payload;
    this.wantRows = false;
    return this;
  }

  update(payload: any) {
    this.op = "update";
    this.payload = payload;
    return this;
  }

  upsert(payload: any, _opts?: { onConflict?: string }) {
    this.op = "upsert";
    this.payload = payload;
    return this;
  }

  delete() {
    this.op = "delete";
    return this;
  }

  eq(col: string, val: any) {
    this.conditions.push({ [col]: val });
    return this;
  }
  neq(col: string, val: any) {
    this.conditions.push({ [col]: { $ne: val } });
    return this;
  }
  lt(col: string, val: any) {
    this.conditions.push({ [col]: { $lt: val } });
    return this;
  }
  lte(col: string, val: any) {
    this.conditions.push({ [col]: { $lte: val } });
    return this;
  }
  gt(col: string, val: any) {
    this.conditions.push({ [col]: { $gt: val } });
    return this;
  }
  gte(col: string, val: any) {
    this.conditions.push({ [col]: { $gte: val } });
    return this;
  }
  in(col: string, vals: any[]) {
    this.conditions.push({ [col]: { $in: vals } });
    return this;
  }
  is(col: string, val: any) {
    this.conditions.push({ [col]: val });
    return this;
  }
  or(expr: string) {
    const parts = expr.split(",").map((piece) => {
      const [col, op, ...rest] = piece.split(".");
      const raw = rest.join(".");
      if (op === "is") return { [col]: parseValue(raw) };
      if (op === "neq") return { [col]: { $ne: parseValue(raw) } };
      if (op === "lt") return { [col]: { $lt: parseValue(raw) } };
      if (op === "gt") return { [col]: { $gt: parseValue(raw) } };
      return { [col]: parseValue(raw) };
    });
    this.conditions.push({ $or: parts });
    return this;
  }

  order(col: string, opts?: { ascending?: boolean }) {
    this.sortSpec = { [col]: opts?.ascending === false ? -1 : 1 };
    return this;
  }

  limit(n: number) {
    this.limitN = n;
    return this;
  }

  single() {
    this.rowMode = "single";
    this.wantRows = true;
    return this;
  }

  maybeSingle() {
    this.rowMode = "maybe";
    this.wantRows = true;
    return this;
  }

  private filter() {
    if (!this.conditions.length) return {};
    if (this.conditions.length === 1) return this.conditions[0];
    return { $and: this.conditions };
  }

  private async collection(): Promise<Collection> {
    const db = await getDb();
    return db.collection(this.table);
  }

  private shape(rows: any[]) {
    return rows.map(({ _id, ...rest }) => rest);
  }

  private async run(): Promise<Result> {
    try {
      const col = await this.collection();

      if (this.op === "insert") {
        const docs = (Array.isArray(this.payload) ? this.payload : [this.payload]).map((d) =>
          applyDefaults(this.table, d),
        );
        await col.insertMany(docs.map((d) => ({ ...d })));
        if (!this.wantRows) return { data: null, error: null };
        return { data: this.rowMode === "many" ? docs : docs[0], error: null };
      }

      if (this.op === "update") {
        await col.updateMany(this.filter(), { $set: this.payload });
        if (!this.wantRows) return { data: null, error: null };
        const rows = this.shape(await col.find(this.filter()).toArray());
        return { data: this.rowMode === "many" ? rows : (rows[0] ?? null), error: null };
      }

      if (this.op === "upsert") {
        const keys = UNIQUE[this.table] ?? ["id"];
        const keyFilter: Record<string, any> = {};
        for (const k of keys) keyFilter[k] = this.payload[k];
        const defaults = applyDefaults(this.table, this.payload);
        const onInsert: Record<string, any> = {};
        for (const [k, v] of Object.entries(defaults)) {
          if (!(k in this.payload)) onInsert[k] = v;
        }
        await col.updateOne(
          keyFilter,
          Object.keys(onInsert).length
            ? { $set: this.payload, $setOnInsert: onInsert }
            : { $set: this.payload },
          { upsert: true },
        );
        return { data: null, error: null };
      }

      if (this.op === "delete") {
        await col.deleteMany(this.filter());
        return { data: null, error: null };
      }

      if (this.headMode && this.countMode) {
        const count = await col.countDocuments(this.filter());
        return { data: null, error: null, count };
      }

      let cursor = col.find(this.filter());
      if (this.projection) cursor = cursor.project(this.projection) as typeof cursor;
      if (this.sortSpec) cursor = cursor.sort(this.sortSpec);
      if (this.limitN !== undefined) cursor = cursor.limit(this.limitN);
      const rows = this.shape(await cursor.toArray());
      if (this.rowMode === "many") return { data: rows, error: null, count: rows.length };
      return { data: rows[0] ?? null, error: rows.length ? null : null };
    } catch (err: any) {
      const message = String(err?.message ?? err);
      return { data: null, error: { message } };
    }
  }

  then<TResult1 = Result, TResult2 = never>(
    onfulfilled?: ((value: Result) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: any) => TResult2 | PromiseLike<TResult2>) | null,
  ): PromiseLike<TResult1 | TResult2> {
    return this.run().then(onfulfilled, onrejected);
  }
}

export type MongoSupabase = { from: (table: string) => QueryBuilder };

export function createClient(): MongoSupabase {
  return { from: (table: string) => new QueryBuilder(table) };
}

export async function closeDb() {
  await client?.close();
  client = undefined;
  dbPromise = undefined;
}
