import { createFileRoute } from "@tanstack/react-router";
import { createClient } from "@supabase/supabase-js";
import { createHash, timingSafeEqual } from "crypto";

const COIN = "CG";
const INTRO_VIDEO_URL =
  "https://project--df5c0224-0a9b-491a-a8d1-60dc4387ca37-dev.lovable.app/__l5e/assets-v1/44cc983b-29b2-4358-a478-976fbd96ea23/coolgram-intro-v2.mp4";
const SIGNUP_BONUS_DEF = 25;
const REFERRAL_BONUS_DEF = 600;


function deriveSecret(apiKey: string) {
  return createHash("sha256").update(`telegram-webhook:${apiKey}`).digest("base64url");
}

function safeEqual(a: string, b: string) {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}

function db() {
  return createClient(process.env["SUPABASE_URL"]!, process.env["SUPABASE_SERVICE_ROLE_KEY"]!, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

// ---------------- Admin + settings ----------------
const OWNER_TG = 6965488457;
const OWNER_USERNAME = "Hidden_Xman";

// ---------------- Mandatory sponsor channel ----------------
const SPONSOR_CHANNEL = "@CoolGramAdvertise";
const SPONSOR_LINK = "https://t.me/CoolGramAdvertise";

const sponsorCache = new Map<number, { ok: boolean; at: number }>();
const SPONSOR_TTL = 10 * 60 * 1000;

async function isSponsorMember(userId: number, force = false): Promise<boolean> {
  const hit = sponsorCache.get(userId);
  if (!force && hit && Date.now() - hit.at < SPONSOR_TTL) return hit.ok;
  const res = await tg("getChatMember", { chat_id: SPONSOR_CHANNEL, user_id: userId });
  // If the bot cannot read the channel (not an admin there), do not block anyone.
  if (!res?.ok) return true;
  const status = res.result?.status;
  const ok = !(status === "left" || status === "kicked");
  sponsorCache.set(userId, { ok, at: Date.now() });
  return ok;
}



function sponsorPrompt() {
  return {
    text:
      "🔒 <b>Join our channel to use Cool Gram</b>\n\n" +
      `Please join ${SPONSOR_LINK} and then press <b>✅ I joined</b> to continue.`,
    reply_markup: {
      inline_keyboard: [
        [{ text: "📢 Join channel", url: SPONSOR_LINK }],
        [{ text: "✅ I joined", callback_data: "chkjoin" }],
      ],
    },
  };
}

async function sponsorGate(userId: number, chatId: number): Promise<boolean> {
  if (userId === OWNER_TG) return true;
  if (await isSponsorMember(userId)) return true;
  const p = sponsorPrompt();
  await send(chatId, p.text, { reply_markup: p.reply_markup });
  return false;
}

const BLOCKED_MSG =
  "🚫 <b>You are blocked</b>\n\nYour access to Cool Gram has been restricted by the administrator.\nIf you think this is a mistake, contact support.";

const blockCache = new Map<number, { v: boolean; t: number }>();
const BLOCK_TTL = 60 * 1000;

async function isBlocked(supabase: ReturnType<typeof db>, userId: number): Promise<boolean> {
  if (userId === OWNER_TG) return false;
  const hit = blockCache.get(userId);
  if (hit && Date.now() - hit.t < BLOCK_TTL) return hit.v;
  const { data } = await supabase
    .from("cg_users")
    .select("blocked")
    .eq("tg_id", userId)
    .maybeSingle();
  const v = Boolean((data as any)?.blocked);
  blockCache.set(userId, { v, t: Date.now() });
  return v;
}

const SETTINGS: Record<string, { def: number; label: string }> = {
  min_channel: { def: 750, label: "Channel subscriber min price" },
  min_group: { def: 600, label: "Group join min price" },
  min_views: { def: 25, label: "Post view min price" },
  min_reactions: { def: 25, label: "Reaction min price" },
  bot_all: { def: 900, label: "Bot start — all users min price" },
  bot_prem: { def: 1400, label: "Bot start — premium only min price" },
  bot_cond_all: { def: 3000, label: "Bot + conditions — all users min price" },
  bot_cond_prem: { def: 4000, label: "Bot + conditions — premium only min price" },
  boost_7: { def: 21000, label: "Telegram Boost 7 days price" },
  boost_30: { def: 90000, label: "Telegram Boost 30 days price" },
  aud_surcharge: { def: 100, label: "Audience filter surcharge" },
  bot_cond_surcharge: { def: 300, label: "Bot conditions audience surcharge" },
  commission_pct: { def: 15, label: "Task creation commission (%)" },
  star_rate: { def: 1900, label: `${COIN} credited per 1 Telegram Star` },
  min_withdraw: { def: 50000, label: "Minimum withdrawal amount" },
  withdraw_open: { def: 1, label: "Withdrawals open (1 = open, 0 = closed)" },
  referral_bonus: { def: REFERRAL_BONUS_DEF, label: "Referral bonus per invited user" },
  ref_daily_max: { def: 20, label: "Max paid referrals per day per user" },
  ref_task_gate: { def: 1, label: "Tasks a referral must complete before bonus is paid" },
  signup_bonus: { def: SIGNUP_BONUS_DEF, label: "Welcome bonus for a new user" },
};

// Friendly aliases so prices can be set with simple words.
const SETTING_ALIASES: Record<string, string> = {
  channel: "min_channel",
  channels: "min_channel",
  group: "min_group",
  groups: "min_group",
  view: "min_views",
  views: "min_views",
  post: "min_views",
  posts: "min_views",
  reaction: "min_reactions",
  reactions: "min_reactions",
  bot: "bot_all",
  bots: "bot_all",
  bot_premium: "bot_prem",
  premium: "bot_prem",
  prime: "bot_prem",
  bot_prime: "bot_prem",
  premium_bot: "bot_prem",
  premium_cond: "bot_cond_prem",
  cond_premium: "bot_cond_prem",
  prime_cond: "bot_cond_prem",
  boost: "boost_7",
  referral: "referral_bonus",
  refer: "referral_bonus",
  signup: "signup_bonus",
  welcome: "signup_bonus",
  commission: "commission_pct",
  stars: "star_rate",
  withdraw: "min_withdraw",
  min_withdrawal: "min_withdraw",
  withdrawal: "min_withdraw",
  withdraw_status: "withdraw_open",
  withdrawals_open: "withdraw_open",
};

const WITHDRAW_CLOSED_MSG =
  "🚧 <b>Withdrawals are temporarily closed.</b>\n\nThey will open again soon — please check back later. Keep earning in the meantime!";

function withdrawOpen() {
  return cfg("withdraw_open") !== 0;
}

function settingKey(raw: string): string | null {
  const k = (raw ?? "").trim().toLowerCase();
  if (SETTINGS[k]) return k;
  const alias = SETTING_ALIASES[k];
  return alias && SETTINGS[alias] ? alias : null;
}


let settingsMap: Record<string, number> = {};
let settingsLoadedAt = 0;
const SETTINGS_TTL_MS = 60_000;

async function loadSettings(supabase: ReturnType<typeof db>, force = false) {
  if (!force && Date.now() - settingsLoadedAt < SETTINGS_TTL_MS) return;
  const { data } = await supabase.from("cg_settings").select("key, value");
  const map: Record<string, number> = {};
  for (const row of (data ?? []) as any[]) map[row.key] = Number(row.value);
  settingsMap = map;
  settingsLoadedAt = Date.now();
}


function cfg(key: keyof typeof SETTINGS | string) {
  const stored = settingsMap[key];
  if (typeof stored === "number" && !Number.isNaN(stored)) return stored;
  return SETTINGS[key]?.def ?? 0;
}

function boostPlans(): { key: string; days: number; price: number }[] {
  return [
    { key: "7", days: 7, price: cfg("boost_7") },
    { key: "30", days: 30, price: cfg("boost_30") },
  ];
}

// Callback ke dauraan pehla sendMessage usi message ko edit kare (naya page na aaye)
let editCtx: { chatId: number; messageId: number; used: boolean } | null = null;

async function tgRaw(method: string, payload: unknown) {
  const token = process.env["TELEGRAM_BOT_TOKEN"] ?? process.env["COOLGRAM_BOT_TOKEN"];
  const res = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  const body = await res.text();
  if (!res.ok) console.error(`Telegram ${method} failed [${res.status}]: ${body}`);
  try {
    return JSON.parse(body);
  } catch {
    return null;
  }
}

// Returns true / false when Telegram can tell us, null when it cannot.
async function botHasMiniApp(link: string | undefined): Promise<boolean | null> {
  const uname = String(link ?? "")
    .replace(/^https?:\/\/t\.me\//i, "")
    .replace(/^@/, "")
    .split(/[/?\s]/)[0];
  if (!uname) return null;
  const res = await tgRaw("getChat", { chat_id: `@${uname}` });
  if (!res?.ok) return null;
  const info = res.result ?? {};
  if (typeof info.has_main_web_app === "boolean") return info.has_main_web_app;
  return null;
}


function parsePostLink(link: string | null): { chat: string | number; msg: number } | null {
  if (!link) return null;
  const priv = link.match(/t\.me\/c\/(\d+)\/(\d+)/);
  if (priv) return { chat: Number(`-100${priv[1]}`), msg: Number(priv[2]) };
  const pub = link.match(/t\.me\/([A-Za-z0-9_]{4,})\/(\d+)/);
  if (pub) return { chat: `@${pub[1]}`, msg: Number(pub[2]) };
  return null;
}

function chatRefFromAd(ad: any): string | number | null {
  if (ad?.src_chat) return Number(ad.src_chat);
  const link: string = ad?.link ?? "";
  const priv = link.match(/t\.me\/c\/(\d+)/);
  if (priv) return Number(`-100${priv[1]}`);
  const pub = link.match(/t\.me\/([A-Za-z0-9_]{4,})/);
  if (pub) return `@${pub[1]}`;
  return null;
}

// t.me/c/... links are not joinable. Build a real invite link for private chats.
async function joinableLink(
  chatId: number | string | null | undefined,
  username?: string | null,
): Promise<string | null> {
  if (username) return `https://t.me/${username}`;
  if (!chatId) return null;
  const created: any = await tg("createChatInviteLink", {
    chat_id: chatId,
    name: "Cool Gram",
    creates_join_request: false,
  });
  if (created?.ok && created.result?.invite_link) return created.result.invite_link;
  const exported: any = await tg("exportChatInviteLink", { chat_id: chatId });
  if (exported?.ok && typeof exported.result === "string") return exported.result;
  const info: any = await tg("getChat", { chat_id: chatId });
  if (info?.ok && info.result?.username) return `https://t.me/${info.result.username}`;
  if (info?.ok && info.result?.invite_link) return info.result.invite_link;
  return null;
}

function isBrokenJoinLink(link: string | null | undefined): boolean {
  return !link || /t\.me\/c\//.test(link);
}




function verifyBlocked(res: any): boolean {
  const d = String(res?.description ?? "").toLowerCase();
  return (
    !res?.ok &&
    (d.includes("member list is inaccessible") ||
      d.includes("chat not found") ||
      d.includes("bot is not a member") ||
      d.includes("not enough rights") ||
      d.includes("user not found"))
  );
}

async function pauseUnverifiableAd(_supabase: any, ad: any, cbId: string) {
  const ref = chatRefFromAd(ad);
  const botId = Number(
    String(process.env["TELEGRAM_BOT_TOKEN"] ?? process.env["COOLGRAM_BOT_TOKEN"] ?? "").split(":")[0],
  );
  const botCheck: any = ref && botId
    ? await tg("getChatMember", { chat_id: ref, user_id: botId })
    : null;
  const botStatus = botCheck?.result?.status;
  const botIsAdmin = botCheck?.ok === true && ["administrator", "creator"].includes(botStatus);
  const botIsOutside = botCheck?.ok === true && ["left", "kicked"].includes(botStatus);

  // Campaign stays active — we never delete or pause it.
  await tg("answerCallbackQuery", {
    callback_query_id: cbId,
    text: botIsAdmin
      ? "⚠️ Cool Gram is already an admin. Telegram could not verify this member yet. Please press Check again."
      : "⚠️ Cool Gram can't verify this chat right now. Make sure you joined, then press Check again.",
    show_alert: true,
  });
  if (ad?.owner_tg) {
    const bot = await botUsername();
    const isChannel = String(ad?.category ?? "").includes("channel");
    if (botIsAdmin || !botIsOutside) {
      await send(
        Number(ad.owner_tg),
        `ℹ️ <b>Your campaign ${ad.title} is still live.</b>\n\nTelegram temporarily could not verify one member. No action is needed.`,
      );
      return;
    }
    await send(
      Number(ad.owner_tg),
      `\u2139\ufe0f Cool Gram could not verify a completion for <b>${ad.title}</b>.\n\n` +
        `Please make <b>@${bot}</b> an admin in that chat. ` +
        `Your campaign is still live.`,
      {
        reply_markup: {
          inline_keyboard: [
            [
              {
                text: "🛡 Add bot as admin",
                url: `https://t.me/${bot}?${isChannel ? "startchannel" : "startgroup"}&admin=${adminDeepLinkRights(isChannel)}`,
              },
            ],
          ],
        },
      },
    );
  }
}


async function tg(method: string, payload: unknown) {
  // Callback spinners ko block na karein — fire and forget
  if (method === "answerCallbackQuery") {
    void tgRaw(method, payload).catch(() => null);
    return { ok: true } as any;
  }
  const p = payload as Record<string, any>;

  if (
    method === "sendMessage" &&
    editCtx &&
    !editCtx.used &&
    p &&
    p["chat_id"] === editCtx.chatId &&
    (!p["reply_markup"] || p["reply_markup"]?.inline_keyboard)
  ) {
    editCtx.used = true;
    const edited = await tgRaw("editMessageText", {
      chat_id: editCtx.chatId,
      message_id: editCtx.messageId,
      text: p["text"],
      parse_mode: p["parse_mode"],
      link_preview_options: p["link_preview_options"] ?? { is_disabled: true },
      reply_markup: p["reply_markup"] ?? { inline_keyboard: [] },
    });
    if (edited?.ok) return edited;
    // edit fail (e.g. video/photo message) -> normal send
  }
  return tgRaw(method, payload);
}



const SUPPORT_BOT = "CoolGramSupport_bot";
const SUPPORT_LINK = `https://t.me/${SUPPORT_BOT}`;

const MAIN_KEYBOARD = {
  keyboard: [
    [{ text: "💰 Earnings" }, { text: "📢 Promote" }],
    [{ text: "💸 Withdrawal" }, { text: "⭐ Deposit" }],
    [{ text: "👛 Wallet" }, { text: "📊 Bots and Statistics" }],
    [{ text: "🆘 Cool Gram Support" }],
    [{ text: "🔗 Useful Links" }],
  ],
  resize_keyboard: true,
};

async function send(chatId: number, text: string, extra: Record<string, unknown> = {}) {
  return tg("sendMessage", {
    chat_id: chatId,
    text,
    parse_mode: "HTML",
    disable_web_page_preview: true,
    reply_markup: MAIN_KEYBOARD,
    ...extra,
  });
}

// Notify the owner when a campaign is finished
async function notifyIfCampaignFinished(supabase: ReturnType<typeof db>, adId: string) {
  const { data: ad } = await supabase
    .from("cg_ads")
    .select("id, owner_tg, title, reward, budget_left, is_active, category")
    .eq("id", adId)
    .maybeSingle();
  const a = ad as any;
  if (!a || !a.is_active) return;
  if (a.budget_left >= a.reward) return;

  await supabase.from("cg_ads").update({ is_active: false }).eq("id", adId);

  const { count } = await supabase
    .from("cg_completions")
    .select("id", { count: "exact", head: true })
    .eq("ad_id", adId);

  await tgRaw("sendMessage", {
    chat_id: a.owner_tg,
    parse_mode: "HTML",
    disable_web_page_preview: true,
    text:
      `✅ <b>Your promotion is complete!</b>\n\n` +
      `📢 <b>${a.title}</b>\n` +
      `👥 Completed by: <b>${count ?? 0}</b> users\n` +
      `💰 Reward per user: <b>${a.reward} ${COIN}</b>\n\n` +
      `The full order has been delivered. Create a new task from 📢 Promote.`,
  });
}


let cachedBotName: string | null = null;
async function botUsername() {
  if (cachedBotName) return cachedBotName;
  const me = await tg("getMe", {});
  cachedBotName = me?.result?.username ?? "CoolGramBot";
  return cachedBotName!;
}

type CgUser = {
  tg_id: number;
  balance: number;
  referral_count: number;
  pending_action: string | null;
};

async function getUser(supabase: ReturnType<typeof db>, from: any, startPayload?: string) {
  const { data: existing } = await supabase
    .from("cg_users")
    .select("tg_id, balance, referral_count, pending_action")
    .eq("tg_id", from.id)
    .maybeSingle();

  if (existing) return { user: existing as unknown as CgUser, isNew: false };

  let referrer: number | null = null;
  const match = startPayload?.match(/^ref_(\d+)$/);
  if (match && Number(match[1]) !== from.id) referrer = Number(match[1]);

  const { data: created } = await supabase
    .from("cg_users")
    .insert({
      tg_id: from.id,
      username: from.username ?? null,
      first_name: from.first_name ?? null,
      balance: cfg("signup_bonus"),
      referred_by: referrer,
    })
    .select("tg_id, balance, referral_count, pending_action")
    .single();

  await supabase.from("cg_transactions").insert({
    tg_id: from.id,
    amount: cfg("signup_bonus"),
    reason: "Welcome bonus",
  });

  if (referrer) {
    await send(
      referrer,
      `👤 <b>New referral joined!</b>\n\nYour bonus of <b>${cfg("referral_bonus")} ${COIN}</b> will be credited once this user completes <b>${cfg("ref_task_gate")}</b> task(s). This protects the program from fake accounts.`,
    );
  }

  return { user: created as unknown as CgUser, isNew: true };
}

// Referral bonus is paid only after the invited user proves to be real
// (completes tasks), and only inside a daily limit per referrer.
async function payReferralIfDue(supabase: ReturnType<typeof db>, tgId: number) {
  try {
    const { data: me } = await supabase
      .from("cg_users")
      .select("tg_id, referred_by, ref_paid")
      .eq("tg_id", tgId)
      .maybeSingle();
    const m = me as any;
    if (!m || !m.referred_by || m.ref_paid) return;

    const gate = Math.max(1, cfg("ref_task_gate"));
    const { count: doneCount } = await supabase
      .from("cg_completions")
      .select("id", { count: "exact", head: true })
      .eq("tg_id", tgId);
    if ((doneCount ?? 0) < gate) return;

    const referrer = Number(m.referred_by);
    const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    const { count: paidToday } = await supabase
      .from("cg_transactions")
      .select("id", { count: "exact", head: true })
      .eq("tg_id", referrer)
      .eq("reason", "Referral bonus")
      .gte("created_at", since);
    if ((paidToday ?? 0) >= Math.max(1, cfg("ref_daily_max"))) {
      await supabase.from("cg_users").update({ ref_paid: true }).eq("tg_id", tgId);
      await send(
        referrer,
        `⚠️ Daily referral limit reached (${cfg("ref_daily_max")} per day). This referral was not paid. Try again tomorrow.`,
      );
      return;
    }

    const { data: refUser } = await supabase
      .from("cg_users")
      .select("balance, referral_count")
      .eq("tg_id", referrer)
      .maybeSingle();
    if (!refUser) return;

    await supabase.from("cg_users").update({ ref_paid: true }).eq("tg_id", tgId);
    await supabase
      .from("cg_users")
      .update({
        balance: Number((refUser as any).balance) + cfg("referral_bonus"),
        referral_count: Number((refUser as any).referral_count) + 1,
      })
      .eq("tg_id", referrer);
    await supabase
      .from("cg_transactions")
      .insert({ tg_id: referrer, amount: cfg("referral_bonus"), reason: "Referral bonus" });
    await send(
      referrer,
      `🎉 <b>Referral confirmed!</b> +${cfg("referral_bonus")} ${COIN} added to your balance.`,
    );
  } catch {
    // never break a completion because of referral accounting
  }
}

const CATEGORIES: { key: string; label: string }[] = [
  { key: "channels", label: "📢 Channels" },
  { key: "groups", label: "👥 Groups" },
  { key: "views", label: "👁 Views" },
  { key: "bots", label: "🤖 Bots" },
  { key: "reactions", label: "🤍 Reactions" },
  { key: "boost", label: "⚡️ Boost" },
];

async function showCategories(supabase: ReturnType<typeof db>, chatId: number) {
  const [{ data: ads }, f] = await Promise.all([
    supabase
      .from("cg_ads")
      .select("id, category, reward, budget_left, link, src_chat")
      .eq("is_active", true)
      .neq("owner_tg", chatId),
    taskFilters(supabase, chatId),
  ]);

  const available = await dropJoinedAds(
    ((ads ?? []) as any[]).filter((a) => f.isAvailable(a)),
    chatId,
  );
  const counts: Record<string, number> = {};
  for (const a of available) {
    counts[a.category] = (counts[a.category] ?? 0) + 1;
  }



  const rows: any[] = [];
  for (let i = 0; i < CATEGORIES.length; i += 2) {
    rows.push(
      CATEGORIES.slice(i, i + 2).map((c) => ({
        text: `${c.label} · ${counts[c.key] ?? 0}`,
        callback_data: `cat:${c.key}`,
      })),
    );
  }
  rows.push([{ text: "📝 Rules", callback_data: "rules" }]);
  rows.push([{ text: "🔙 Back", callback_data: "back" }]);

  await send(chatId, "📝 <b>Choose a task category to earn</b>", {
    reply_markup: { inline_keyboard: rows },
  });
}

const PAGE_SIZE = 10;

// Shared availability filter so category counts and the task list always agree.
async function taskFilters(supabase: ReturnType<typeof db>, chatId: number) {
  const [{ data: done }, { data: proofs }] = await Promise.all([
    supabase.from("cg_completions").select("ad_id").eq("tg_id", chatId),
    supabase.from("cg_proofs").select("ad_id, status").eq("tg_id", chatId),
  ]);
  const doneIds = ((done ?? []) as any[]).map((d) => d.ad_id);
  const doneSet = new Set(doneIds.map(String));

  const pendingSet = new Set(
    ((proofs ?? []) as any[])
      .filter((p) => ["pending", "approved", "auto_approved"].includes(String(p.status)))
      .map((p) => String(p.ad_id)),
  );

  let doneRefs = new Set<string>();
  if (doneIds.length) {
    const { data: doneAds } = await supabase.from("cg_ads").select("id, link, src_chat").in("id", doneIds);
    doneRefs = new Set(
      ((doneAds ?? []) as any[])
        .map((a) => chatRefFromAd(a))
        .filter(Boolean)
        .map((r) => String(r).toLowerCase()),
    );
  }

  return {
    doneIds,
    isAvailable(ad: any) {
      if (Number(ad.budget_left) < Number(ad.reward)) return false;
      if (doneSet.has(String(ad.id)) || pendingSet.has(String(ad.id))) return false;
      const ref = chatRefFromAd(ad);
      if (ref && doneRefs.has(String(ref).toLowerCase())) return false;
      return true;
    },
  };
}

// Hide join tasks for chats the user is already a member of (even from long ago).
const memberCache = new Map<string, { joined: boolean; at: number }>();
const MEMBER_TTL = 5 * 60 * 1000;

async function isChatMemberCached(ref: string, userId: number) {
  const key = `${userId}:${ref}`;
  const hit = memberCache.get(key);
  if (hit && Date.now() - hit.at < MEMBER_TTL) return hit.joined;
  const res: any = await tg("getChatMember", { chat_id: ref, user_id: userId });
  const st = res?.result?.status;
  const joined =
    res?.ok === true && ["member", "administrator", "creator", "restricted"].includes(st);
  if (res?.ok === true) memberCache.set(key, { joined, at: Date.now() });
  return joined;
}

async function dropJoinedAds(ads: any[], chatId: number) {
  const joinKinds = new Set(["channels", "groups", "boost"]);
  const targets = ads.filter((a) => joinKinds.has(String(a.category ?? ""))).slice(0, 20);
  if (!targets.length) return ads;
  const checks = await Promise.all(
    targets.map(async (a) => {
      const ref = chatRefFromAd(a);
      if (!ref) return false;
      return isChatMemberCached(String(ref), chatId);
    }),
  );
  const joined = new Set(targets.filter((_, i) => checks[i]).map((a) => String(a.id)));
  return joined.size ? ads.filter((a) => !joined.has(String(a.id))) : ads;
}




function actionVerb(category?: string) {
  if (category === "groups") return "Join";
  if (category === "views") return "View";
  if (category === "bots") return "Start";
  if (category === "reactions") return "React";
  if (category === "boost") return "Boost";
  return "Subscribe";
}

function listHeader(category?: string) {
  if (category === "views")
    return "To earn grams, you need to view posts, click on the buttons to view.\n\nAttention! Some posts are too long, in this case, you need to scroll it up and down.";
  if (category === "groups")
    return "⚠️ Don't leave groups earlier than 7 days. Otherwise task completion will be blocked and the GRAM earned from them revoked.";
  if (category === "bots")
    return "⚠️ Don't stop or delete the bots earlier than 7 days. Otherwise task completion will be blocked and the GRAM earned from them revoked.";
  if (category === "reactions")
    return "⚠️ Don't remove your reaction earlier than 7 days. Otherwise task completion will be blocked and the GRAM earned from them revoked.";
  if (category === "boost")
    return (
      "⚡️ <b>Premium boost tasks</b>\n\n" +
      "Only Telegram Premium users can boost a channel or group.\n" +
      "Press <b>Boost</b>, confirm the boost in Telegram, then press <b>Check</b>.\n\n" +
      "💰 You are paid <b>every day</b> for keeping the boost active. Press <b>Check</b> once every 24 hours to get the daily payout — the bot will remind you.\n" +
      "⚠️ If you remove the boost before the task ends, the remaining payouts are lost."
    );

  return "⚠️ Don't leave channels earlier than 7 days. Otherwise task completion will be blocked and the GRAM earned from them revoked.";
}

const BOT_SUBTYPES: { key: string; label: string; title: string; desc: string }[] = [
  {
    key: "plain",
    label: "🤖 Ordinary Bots",
    title: "🤖 Standard bots",
    desc: "Regular Telegram bots, launch only.",
  },
  {
    key: "webapp",
    label: "📱 Bots with Mini App",
    title: "📱 Mini App bots",
    desc: "Open a mini app in Telegram.",
  },

  {
    key: "cond",
    label: "🤖 With additional conditions",
    title: "🤖 With extra conditions",
    desc: "Besides Start you must complete actions: pass a captcha, subscribe to sponsors, etc.",
  },
];

async function showBotSubcategories(supabase: ReturnType<typeof db>, chatId: number) {
  const { data: ads } = await supabase
    .from("cg_ads")
    .select("id, subtype, reward, budget_left, link, src_chat")
    .eq("is_active", true)
    .eq("category", "bots")
    .neq("owner_tg", chatId);
  const f = await taskFilters(supabase, chatId);
  const counts: Record<string, number> = {};
  for (const a of (ads ?? []) as any[]) {
    if (!f.isAvailable(a)) continue;
    const k = a.subtype ?? "plain";
    counts[k] = (counts[k] ?? 0) + 1;
  }

  const body = BOT_SUBTYPES.map(
    (s) => `${s.title} — ${(counts[s.key] ?? 0).toLocaleString("en-US")}\n${s.desc}`,
  ).join("\n\n");

  await send(chatId, `<b>Choose a task category:</b>\n\n${body}`, {
    reply_markup: {
      inline_keyboard: [
        [
          { text: BOT_SUBTYPES[0]!.label, callback_data: "botcat:plain" },
          { text: BOT_SUBTYPES[1]!.label, callback_data: "botcat:webapp" },
        ],
        [{ text: BOT_SUBTYPES[2]!.label, callback_data: "botcat:cond" }],
        [{ text: "🔙 Back", callback_data: "earn" }],
      ],
    },
  });
}

function boostUrl(link: string) {
  const base = String(link ?? "").split("?")[0];
  return `${base}?boost`;
}

function boostDays(ad: any) {
  const d = Number(ad?.boost_days);
  return Number.isFinite(d) && d > 0 ? d : 7;
}

function boostDayReward(ad: any) {
  return Math.max(1, Math.floor(Number(ad?.reward ?? 0) / boostDays(ad)));
}

async function showMyTasks(supabase: ReturnType<typeof db>, chatId: number) {
  const { data: mine } = await supabase
    .from("cg_ads")
    .select("id, title, reward, budget_left, is_active, category")
    .eq("owner_tg", chatId)
    .order("created_at", { ascending: false })
    .limit(10);
  const list = (mine ?? []) as any[];
  const lines = list.map(
    (a) =>
      `${a.is_active ? "🟢" : "⚪️"} <b>${a.title}</b> · ${a.category}\n   Reward ${a.reward} ${COIN} • Left ${a.budget_left} ${COIN}`,
  );
  const rows: any[] = list
    .filter((a) => a.is_active)
    .map((a) => [
      {
        text: `❌ Cancel — ${String(a.title).slice(0, 25)}`,
        callback_data: `cancel:${a.id}`,
      },
    ]);
  rows.push([{ text: "🔙 Back", callback_data: "promo_menu" }]);
  await send(chatId, `📋 <b>My Tasks</b>\n\n${lines.length ? lines.join("\n") : "No campaigns yet."}`, {
    reply_markup: { inline_keyboard: rows },
  });
}

async function handleBoostClaim(
  supabase: ReturnType<typeof db>,
  chatId: number,
  ad: any,
  callbackId?: string,
) {
  const days = boostDays(ad);
  const perDay = boostDayReward(ad);

  const { data: claimRow } = await supabase
    .from("cg_boost_claims")
    .select("id, days_claimed, total_days, last_claim_at, status")
    .eq("ad_id", ad.id)
    .eq("tg_id", chatId)
    .maybeSingle();
  const claim = claimRow as any;

  if (claim && claim.status === "done") {
    if (callbackId)
      await tg("answerCallbackQuery", {
        callback_query_id: callbackId,
        text: "You have already finished this boost task.",
        show_alert: true,
      });
    return;
  }

  if (claim) {
    const elapsed = Date.now() - new Date(claim.last_claim_at).getTime();
    const remain = 24 * 60 * 60 * 1000 - elapsed;
    if (remain > 0) {
      const h = Math.floor(remain / 3600000);
      const m = Math.floor((remain % 3600000) / 60000);
      if (callbackId)
        await tg("answerCallbackQuery", {
          callback_query_id: callbackId,
          text: `⏳ Already paid for today. Keep the boost active — next payout in ${h}h ${m}m.`,
          show_alert: true,
        });
      return;
    }
  }

  const claimed = (claim?.days_claimed ?? 0) + 1;
  const nowIso = new Date().toISOString();
  if (claim) {
    await supabase
      .from("cg_boost_claims")
      .update({
        days_claimed: claimed,
        last_claim_at: nowIso,
        reminded_at: null,
        status: claimed >= days ? "done" : "active",
      })
      .eq("id", claim.id);
  } else {
    const { error } = await supabase.from("cg_boost_claims").insert({
      ad_id: ad.id,
      tg_id: chatId,
      total_days: days,
      days_claimed: 1,
      last_claim_at: nowIso,
      status: days <= 1 ? "done" : "active",
    });
    if (error) {
      if (callbackId)
        await tg("answerCallbackQuery", { callback_query_id: callbackId, text: "Please try again." });
      return;
    }
  }

  const { data: user } = await supabase
    .from("cg_users")
    .select("balance")
    .eq("tg_id", chatId)
    .maybeSingle();
  const newBalance = Number((user as any)?.balance ?? 0) + perDay;
  await supabase.from("cg_users").update({ balance: newBalance }).eq("tg_id", chatId);
  await supabase
    .from("cg_ads")
    .update({ budget_left: Math.max(0, Number(ad.budget_left) - perDay) })
    .eq("id", ad.id);
  await supabase
    .from("cg_transactions")
    .insert({ tg_id: chatId, amount: perDay, reason: `Boost day ${claimed}: ${ad.title}` });

  if (callbackId)
    await tg("answerCallbackQuery", { callback_query_id: callbackId, text: `+${perDay} ${COIN} 🎉` });

  if (claimed >= days) {
    await supabase.from("cg_completions").insert({ ad_id: ad.id, tg_id: chatId });
    await payReferralIfDue(supabase, chatId);
    await notifyIfCampaignFinished(supabase, ad.id);
    await send(
      chatId,
      `🏁 <b>Boost task finished!</b>\n\nYou kept the boost for ${days} days and earned <b>${(perDay * days).toLocaleString("en-US")} ${COIN}</b> in total.\n💰 Balance: ${newBalance.toLocaleString("en-US")} ${COIN}`,
      { reply_markup: { inline_keyboard: [[{ text: "🔙 Back", callback_data: "cat:boost" }]] } },
    );
  } else {
    await send(
      chatId,
      `✅ <b>Boost day ${claimed} of ${days} paid — +${perDay.toLocaleString("en-US")} ${COIN}</b>\n\n` +
        `💰 Balance: ${newBalance.toLocaleString("en-US")} ${COIN}\n` +
        `⚠️ Keep the boost active. Come back in <b>24 hours</b> and press Check again to get the next ${perDay.toLocaleString("en-US")} ${COIN}.\n` +
        `If you remove the boost, the task stops and the remaining ${COIN} are lost.`,
      {
        reply_markup: {
          inline_keyboard: [
            [{ text: "🔄 Check boost", callback_data: `done:${ad.id}` }],
            [{ text: "🔙 Back", callback_data: "cat:boost" }],
          ],
        },
      },
    );
  }
}



async function showTask(
  supabase: ReturnType<typeof db>,
  chatId: number,
  category?: string,
  page = 0,
  subtype?: string,
  isPremium?: boolean,
) {
  if (category === "boost" && isPremium === false) {
    await send(
      chatId,
      "⚡️ <b>Premium boost tasks</b>\n\nOnly users with <b>Telegram Premium</b> can complete boost tasks.\nGet Telegram Premium and come back to earn from these tasks.",
      { reply_markup: { inline_keyboard: [[{ text: "🔙 Back", callback_data: "earn" }]] } },
    );
    return;
  }
  const backCb = category === "bots" ? "cat:bots" : "earn";

  let query = supabase
    .from("cg_ads")
    .select("id, title, link, reward, budget_left, boost_days, src_chat, subtype, conditions")
    .eq("is_active", true)
    .neq("owner_tg", chatId)
    .order("reward", { ascending: false });
  if (category) query = query.eq("category", category);
  if (subtype) {
    if (subtype === "plain") query = query.or("subtype.is.null,subtype.eq.plain");
    else query = query.eq("subtype", subtype);
  }
  const [{ data: allAds }, f] = await Promise.all([query, taskFilters(supabase, chatId)]);

  let ads = ((allAds ?? []) as any[]).filter((a) => f.isAvailable(a));


  // For join tasks, hide chats the user is already a member of
  if (category === "channels" || category === "groups" || category === "boost") {
    ads = await dropJoinedAds(
      ads.map((a) => ({ ...a, category })),
      chatId,
    );
  }



  if (!ads.length) {
    await send(
      chatId,
      "😴 <b>No tasks available in this category right now.</b>\n\nCome back a bit later — new tasks are added every day.",
      { reply_markup: { inline_keyboard: [[{ text: "🔙 Back", callback_data: backCb }]] } },
    );
    return;
  }

  const totalPages = Math.max(1, Math.ceil(ads.length / PAGE_SIZE));
  const p = Math.min(Math.max(page, 0), totalPages - 1);
  const slice = ads.slice(p * PAGE_SIZE, p * PAGE_SIZE + PAGE_SIZE);
  const verb = actionVerb(category);
  const cat = subtype ? `${category}|${subtype}` : (category ?? "");
  const isViews = category === "views";

  // Repair old private-chat links (t.me/c/...) which Telegram cannot open.
  if (category === "channels" || category === "groups" || category === "boost") {
    await Promise.all(
      slice.map(async (ad: any) => {
        if (!isBrokenJoinLink(ad.link)) return;
        const ref = chatRefFromAd(ad);
        const fixed = await joinableLink(ref);
        if (!fixed || fixed === ad.link) return;
        ad.link = fixed;
        await supabase.from("cg_ads").update({ link: fixed }).eq("id", ad.id);
      }),
    );
  }



  const shown = slice.filter((ad: any) => isViews || !isBrokenJoinLink(ad.link));
  if (!shown.length) {
    await send(
      chatId,
      "😴 <b>No tasks available in this category right now.</b>\n\nCome back a bit later — new tasks are added every day.",
      { reply_markup: { inline_keyboard: [[{ text: "🔙 Back", callback_data: backCb }]] } },
    );
    return;
  }

  const rows: any[] = shown.map((ad) =>

    isViews
      ? [
          {
            text: `👁 View Post +${ad.reward.toLocaleString("en-US")} ${COIN}`,
            callback_data: `view:${ad.id}`,
          },
        ]
      : [
          {
            text:
              category === "boost"
                ? `💲 +${boostDayReward(ad).toLocaleString("en-US")} / day | ${verb}`
                : `💲 +${ad.reward.toLocaleString("en-US")} | ${verb}`,
            url: category === "boost" ? boostUrl(ad.link) : ad.link,
          },
          (ad as any).conditions || category === "bots"
            ? { text: "📸 Send proof", callback_data: `proof:${ad.id}` }
            : { text: "🔄 Check", callback_data: `done:${ad.id}` },

        ],

  );

  rows.push([
    { text: "1", callback_data: `page:${cat}:0` },
    { text: "◀️", callback_data: `page:${cat}:${Math.max(p - 1, 0)}` },
    { text: `${p + 1}`, callback_data: "noop" },
    { text: "▶️", callback_data: `page:${cat}:${Math.min(p + 1, totalPages - 1)}` },
    { text: `${totalPages}`, callback_data: `page:${cat}:${totalPages - 1}` },
  ]);
  if (!isViews) rows.push([{ text: "❌ Report", callback_data: `report:${cat}` }]);
  rows.push([{ text: "🔙 Back", callback_data: backCb }]);

  await send(chatId, listHeader(category), { reply_markup: { inline_keyboard: rows } });
}



const PROMO_TYPES = [
  { key: "channels", label: "📣 Channel" },
  { key: "groups", label: "👥 Group" },
  { key: "views", label: "👁 Post" },
  { key: "bots", label: "🤖 Bot" },
  { key: "boost", label: "⚡ Premium boost (channel)" },

  { key: "reactions", label: "💙 Reactions" },
];

async function showPromoteMenu(supabase: ReturnType<typeof db>, chatId: number) {
  const { data: u } = await supabase
    .from("cg_users")
    .select("balance")
    .eq("tg_id", chatId)
    .maybeSingle();
  const balance = (u as any)?.balance ?? 0;

  const rows: any[] = [];
  for (let i = 0; i < PROMO_TYPES.length; i += 2) {
    rows.push(
      PROMO_TYPES.slice(i, i + 2).map((t) => ({ text: t.label, callback_data: `promo:${t.key}` })),
    );
  }
  rows.push([{ text: "⚙️ Auto-task settings", callback_data: "promo_auto" }]);
  rows.push([
    { text: "📋 My Tasks", callback_data: "promo_mine" },
    { text: "🔙 Back", callback_data: "back" },
  ]);

  await send(chatId, `🅰️ <b>What do you want to promote?</b>\n\n💲 Balance: <b>${balance} ${COIN}</b>`, {
    reply_markup: { inline_keyboard: rows },
  });
}

async function askChatPicker(
  supabase: ReturnType<typeof db>,
  chatId: number,
  category: string,
  isChannel: boolean,
) {
  await supabase.from("cg_users").update({ pending_action: `pick:${category}` }).eq("tg_id", chatId);
  const bot = await botUsername();
  await tg("sendMessage", {
    chat_id: chatId,
    text:
      `📣 <b>Choose a chat or ${isChannel ? "channel" : "group"} to promote</b>\n\n` +
      `Tap <b>🏠 Select my chat</b>. Telegram will add <b>@${bot}</b> as admin if needed, then return you here automatically.`,
    parse_mode: "HTML",
    reply_markup: {
      keyboard: [
        [
          {
            text: "🏠 Select my chat",
            request_chat: {
              request_id: 1,
              chat_is_channel: isChannel,
              request_title: true,
              request_username: true,
              // Keep the filter minimal, otherwise Telegram shows an empty list.
              bot_administrator_rights: {
                is_anonymous: false,
                can_manage_chat: true,
                can_invite_users: true,
              },
            },
          },
        ],
        [{ text: "🔙 Back" }],
      ],
      resize_keyboard: true,
      one_time_keyboard: true,
    },
  });
}

// Every admin right except the owner-only ones (promote members / anonymous).
function fullBotRights(isChannel: boolean) {
  return {
    is_anonymous: false,
    can_promote_members: false,
    can_manage_chat: true,
    can_change_info: true,
    can_delete_messages: true,
    can_invite_users: true,
    can_restrict_members: true,
    can_manage_video_chats: true,
    can_post_stories: true,
    can_edit_stories: true,
    can_delete_stories: true,
    ...(isChannel
      ? { can_post_messages: true, can_edit_messages: true }
      : { can_pin_messages: true, can_manage_topics: true }),
  };
}

function adminDeepLinkRights(isChannel: boolean) {
  const base = [
    "manage_chat",
    "change_info",
    "delete_messages",
    "invite_users",
    "restrict_members",
    "manage_video_chats",
    "post_stories",
    "edit_stories",
    "delete_stories",
  ];
  const extra = isChannel
    ? ["post_messages", "edit_messages"]
    : ["pin_messages", "manage_topics"];
  return [...base, ...extra].join("+");
}

async function recordBotChat(
  supabase: ReturnType<typeof db>,
  chat: any,
  status: string,
  addedBy?: number | null,
) {
  if (!chat?.id) return;
  const active = ["administrator", "creator"].includes(status);
  if (active) {
    await supabase.from("cg_bot_chats").upsert(
      {
        chat_id: Number(chat.id),
        title: chat.title ?? chat.username ?? String(chat.id),
        username: chat.username ?? null,
        type: chat.type ?? null,
        status,
        added_by: addedBy ?? null,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "chat_id" },
    );
  } else {
    await supabase.from("cg_bot_chats").delete().eq("chat_id", Number(chat.id));
  }
}

async function handleBotMembershipUpdate(supabase: ReturnType<typeof db>, membership: any) {
  const userId = Number(membership?.from?.id);
  const chat = membership?.chat;
  const status = String(membership?.new_chat_member?.status ?? "");
  await recordBotChat(supabase, chat, status, userId || null);
  if (!userId || !chat?.id || !["administrator", "creator"].includes(status)) return;


  const { data: user } = await supabase
    .from("cg_users")
    .select("pending_action")
    .eq("tg_id", userId)
    .maybeSingle();
  const pending = String((user as any)?.pending_action ?? "");
  if (!pending.startsWith("pick:")) return;

  await send(userId, `✅ <b>Cool Gram is now an admin in ${chat.title ?? "your chat"}.</b>\n\nContinuing your promotion setup…`, {
    reply_markup: { remove_keyboard: true },
  });
  await handleChatShared(supabase, userId, {
    chat_id: chat.id,
    title: chat.title,
    username: chat.username,
  });
}


async function showBoostTypeMenu(supabase: ReturnType<typeof db>, chatId: number) {
  await supabase.from("cg_users").update({ pending_action: null }).eq("tg_id", chatId);
  await send(
    chatId,
    "⚡️ <b>Choose a channel or group for Telegram Boost</b>\nIt must be public (with an @link).",
    {
      reply_markup: {
        inline_keyboard: [
          [{ text: "📣 Channel", callback_data: "boostpick:channel" }],
          [{ text: "👥 Group", callback_data: "boostpick:group" }],
          [{ text: "🔙 Back", callback_data: "promo_menu" }],
        ],
      },
    },
  );
}

async function showBoostDuration(supabase: ReturnType<typeof db>, chatId: number, info: any) {
  await supabase
    .from("cg_users")
    .update({ pending_action: `boostdur:${JSON.stringify(info)}` })
    .eq("tg_id", chatId);
  await send(chatId, "🕐 <b>Choose the Telegram Boost duration.</b>", {
    reply_markup: {
      inline_keyboard: [
        ...boostPlans().map((p) => [
          {
            text: `⚡️ ${p.days} days - ${p.price.toLocaleString("en-US")} ${COIN}`,
            callback_data: `boostdur:${p.key}`,
          },
        ]),
        [{ text: "🔙 Back", callback_data: "back:boosttype" }],
      ],
    },
  });
}

async function showBotPromoInfo(supabase: ReturnType<typeof db>, chatId: number, webapp = false) {
  await supabase.from("cg_users").update({ pending_action: null }).eq("tg_id", chatId);
  await tg("sendMessage", {
    chat_id: chatId,
    text:
      (webapp
        ? "📱 <b>Choose the bot with a web app (Telegram Mini App) you want to promote</b>\n\nWorkers will open your bot, launch the mini app and use it.\n\n"
        : "🤖 <b>Choose the bot you want to promote</b>\n\n") +
      "<blockquote>❓ <b>What should you know?</b>\n" +
      "• A user can complete a task for this bot only once in COOL GRAM.\n" +
      "• Every completion can be checked for correctness before payment.\n" +
      "• A user may have started the bot previously outside COOL GRAM — such completions are paid.\n\n" +
      "⛔️ <b>You cannot advertise:</b>\n" +
      "• 18+ and erotic content\n" +
      "• Scams, pyramid schemes, deception\n" +
      "• Casinos, betting, artificial boosting\n" +
      "• Piracy, cracked content\n" +
      "• Phishing, account theft, malware\n" +
      "• Doxxing, other people's personal data</blockquote>",
    parse_mode: "HTML",
    reply_markup: {
      inline_keyboard: [
        [
          { text: webapp ? "📱 Choose bot" : "🤖 Choose bot", callback_data: webapp ? "bot_pick:webapp" : "bot_pick" },
          { text: "⬅️ Back", callback_data: "promo_menu" },
        ],
      ],
    },
  });
}

async function askBotLink(supabase: ReturnType<typeof db>, chatId: number, webapp = false) {
  await supabase
    .from("cg_users")
    .update({ pending_action: webapp ? "botlinkwa" : "botlink" })
    .eq("tg_id", chatId);
  await tg("sendMessage", {
    chat_id: chatId,
    text: "🤖 Select a bot.",
    reply_markup: {
      keyboard: [
        [
          {
            text: "🤖 Select a bot.",
            request_users: {
              request_id: 7,
              user_is_bot: true,
              max_quantity: 1,
              request_name: true,
              request_username: true,
            },
          },
        ],
        [{ text: "⬅️ Back" }],
      ],
      resize_keyboard: true,
      one_time_keyboard: true,
    },
  });
}

async function handleUsersShared(supabase: ReturnType<typeof db>, chatId: number, shared: any) {
  const { data: pu } = await supabase
    .from("cg_users")
    .select("pending_action")
    .eq("tg_id", chatId)
    .maybeSingle();
  const isWebapp = (pu as any)?.pending_action === "botlinkwa";
  const picked = (shared.users ?? shared.user_ids ?? [])[0];
  const uname = typeof picked === "object" ? picked?.username : undefined;
  const title = (typeof picked === "object" ? picked?.first_name : undefined) ?? uname ?? "My bot";
  if (!uname) {
    await send(
      chatId,
      "⚠️ Could not get that bot's username. Send its username or link:\n<code>@MyCoolBot</code>",
      { reply_markup: MAIN_KEYBOARD },
    );
    return;
  }
  const link = `https://t.me/${uname}`;
  await askBotRefLink(supabase, chatId, { category: "bots", title, link, webapp: isWebapp });
}

async function setPending(supabase: ReturnType<typeof db>, chatId: number, prefix: string, info: any) {
  await supabase
    .from("cg_users")
    .update({ pending_action: `${prefix}:${JSON.stringify(info)}` })
    .eq("tg_id", chatId);
}

async function getPendingInfo(supabase: ReturnType<typeof db>, chatId: number, prefix: string) {
  const { data: u } = await supabase
    .from("cg_users")
    .select("pending_action")
    .eq("tg_id", chatId)
    .maybeSingle();
  const pending = (u as any)?.pending_action as string | null;
  if (!pending?.startsWith(`${prefix}:`)) return null;
  try {
    return JSON.parse(pending.slice(prefix.length + 1));
  } catch {
    return null;
  }
}

async function askBotRefLink(supabase: ReturnType<typeof db>, chatId: number, info: any) {
  await setPending(supabase, chatId, "botref", info);
  await tg("sendMessage", {
    chat_id: chatId,
    text:
      "🔗 <b>Send the referral link for the selected bot</b>\n\n" +
      "<blockquote>Example: https://t.me/gram_piarbot?start=123456789</blockquote>\n" +
      `<blockquote><b>${info.title}</b>\n${info.link}</blockquote>`,
    parse_mode: "HTML",
    link_preview_options: { is_disabled: true },
    reply_markup: {
      inline_keyboard: [
        [{ text: "➡️ Skip", callback_data: "botref_skip" }],
        [{ text: "⬅️ Back", callback_data: "back:botpick" }],
      ],
    },
  });
}

async function showBotTaskType(supabase: ReturnType<typeof db>, chatId: number, info: any) {
  info.webapp = false;
  await setPending(supabase, chatId, "bottype", info);
  await tg("sendMessage", {
    chat_id: chatId,
    text:
      "🤖 <b>Choose the task type:</b>\n\n" +
      "▶️ <b>Bot start only</b> — the worker opens the bot and presses Start (+ completes a captcha or selects a language, if prompted). No other actions.\n\n" +
      "📱 <b>Bot with mini app</b> — the worker opens your bot and launches the Telegram Mini App. Only mini app bots.\n\n" +
      "📝 <b>With additional conditions</b> — you can request additional actions. For example, subscribing to sponsors or completing a simple action.",
    parse_mode: "HTML",
    reply_markup: {
      inline_keyboard: [
        [{ text: "▶️ Bot start only", callback_data: "bottype:start" }],
        [{ text: "📱 Bot with mini app", callback_data: "bottype:webapp" }],
        [{ text: "📝 With additional conditions", callback_data: "bottype:cond" }],
        [{ text: "⬅️ Back", callback_data: "back:botref" }],
      ],
    },
  });
}


async function askBotConditions(supabase: ReturnType<typeof db>, chatId: number, info: any) {
  await setPending(supabase, chatId, "botcond", info);
  await tg("sendMessage", {
    chat_id: chatId,
    text:
      "📝 <b>Describe the task conditions</b> — what the worker must do after starting the bot. For example: press a button, complete a captcha, subscribe to sponsors.\n\n" +
      "<blockquote>⛔ <b>You cannot require:</b>\n" +
      "• personal data (name, phone number, email, documents, KYC)\n" +
      "• payment/top-up\n" +
      "• actions taking longer than 10 minutes\n" +
      "• third-party services (OAuth, API, Telegram Login)\n" +
      "• involving other people (referrals)\n" +
      "• following suspicious links</blockquote>\n\n" +
      "No more than 400 characters.",
    parse_mode: "HTML",
    link_preview_options: { is_disabled: true },
    reply_markup: { inline_keyboard: [[{ text: "⬅️ Back", callback_data: "back:bottype" }]] },
  });
}

async function showBotAudience(supabase: ReturnType<typeof db>, chatId: number, info: any) {
  await setPending(supabase, chatId, "botaud", info);
  const cond = Boolean(info.conditions);
  const priceAll = (cond ? cfg("bot_cond_all") : cfg("bot_all")).toLocaleString("en-US");
  const pricePrem = (cond ? cfg("bot_cond_prem") : cfg("bot_prem")).toLocaleString("en-US");
  await tg("sendMessage", {
    chat_id: chatId,
    text:
      `1️⃣ <b>All users</b>\nBroad reach among all COOL GRAM users.\n💡 Minimum price: ${priceAll} ${COIN}/unit.\n\n` +
      `2️⃣ <b>Telegram Premium only</b>\nShown only to Telegram Premium users — a higher-quality audience.\n💡 Minimum price: ${pricePrem} ${COIN}/unit.`,
    parse_mode: "HTML",
    reply_markup: {
      inline_keyboard: [
        [{ text: "1️⃣ All users", callback_data: "botaud:all" }],
        [{ text: "2️⃣ Telegram Premium only", callback_data: "botaud:premium" }],
        [{ text: "⬅️ Back", callback_data: cond ? "back:botcond" : "back:bottype" }],
      ],
    },
  });
}




async function askReactionLink(supabase: ReturnType<typeof db>, chatId: number) {
  await supabase.from("cg_users").update({ pending_action: "reactlink" }).eq("tg_id", chatId);
  await tg("sendMessage", {
    chat_id: chatId,
    text:
      "🔗 <b>Send the link to the post you want reactions for.</b>\n\n" +
      "💡 Not sure how to copy a link? Watch the <a href=\"https://telegram.org/faq#q-what-are-message-links\">guide</a> 🎥.",
    parse_mode: "HTML",
    link_preview_options: { is_disabled: true },
    reply_markup: { inline_keyboard: [[{ text: "⬅️ Back", callback_data: "promo_menu" }]] },
  });
}

async function askForwardPost(supabase: ReturnType<typeof db>, chatId: number) {
  await supabase.from("cg_users").update({ pending_action: "fwd:views" }).eq("tg_id", chatId);
  await tg("sendMessage", {
    chat_id: chatId,
    text: "🔁 <b>Forward the post you want to promote.</b>\n\n<blockquote>Open the channel → pick the post → Forward → COOL GRAM</blockquote>",
    parse_mode: "HTML",
    reply_markup: { inline_keyboard: [[{ text: "⬅️ Back", callback_data: "promo_menu" }]] },
  });
}

async function handleForwardedPost(supabase: ReturnType<typeof db>, chatId: number, message: any) {
  const origin = message.forward_origin ?? {};
  const originChat = origin.chat ?? message.forward_from_chat;
  const msgId = origin.message_id ?? message.forward_from_message_id;
  if (!originChat || !msgId) {
    await send(chatId, "⚠️ This post is not forwarded from a channel. Please forward a channel post.");
    return;
  }
  const title = originChat.title ?? "Post";

  // The bot must be an admin in that channel
  const me = await tg("getMe", {});
  const botId = me?.result?.id;
  const botUsername = me?.result?.username;
  const member = await tg("getChatMember", { chat_id: originChat.id, user_id: botId });
  const status = member?.result?.status;
  if (status !== "administrator" && status !== "creator") {
    await tg("sendMessage", {
      chat_id: chatId,
      text: `⛔️ <b>The bot lacks admin rights.</b>\nAdd the bot to the channel and try again.`,
      parse_mode: "HTML",
      reply_markup: {
        inline_keyboard: [
          [
            {
              text: "➕ Add bot to channel",
              url: `https://t.me/${botUsername}?startchannel=true&admin=${adminDeepLinkRights(true)}`,
            },
          ],
        ],
      },
    });
    await askForwardPost(supabase, chatId);
    return;
  }

  const link = originChat.username
    ? `https://t.me/${originChat.username}/${msgId}`
    : `https://t.me/c/${String(originChat.id).replace("-100", "")}/${msgId}`;

  await supabase
    .from("cg_users")
    .update({
      pending_action: `aud:${JSON.stringify({ category: "views", title, link, base_min_price: cfg("min_views"), min_price: cfg("min_views"), src_chat: originChat.id, src_msg: msgId })}`,
    })
    .eq("tg_id", chatId);

  await showAudienceMenu(chatId, "no restrictions", cfg("aud_surcharge"), "back:fwd");
}


async function handleChatShared(supabase: ReturnType<typeof db>, chatId: number, shared: any) {
  const { data: u } = await supabase
    .from("cg_users")
    .select("pending_action")
    .eq("tg_id", chatId)
    .maybeSingle();
  const pending = (u as any)?.pending_action as string | null;
  const category = pending?.startsWith("pick:") ? pending.slice(5) : "channels";

  const botId = Number(
    String(process.env["TELEGRAM_BOT_TOKEN"] ?? process.env["COOLGRAM_BOT_TOKEN"] ?? "").split(":")[0],
  );
  if (botId && shared?.chat_id) {
    const chk: any = await tg("getChatMember", { chat_id: shared.chat_id, user_id: botId });
    const st = String(chk?.result?.status ?? "");
    const isAdmin = ["administrator", "creator"].includes(st);
    if (!isAdmin) {
      const isCh = category === "channels" || category.startsWith("boost_ch");
      const bot = await botUsername();
      await send(
        chatId,
        `🔒 <b>Cool Gram must be an admin in ${shared.title ?? "that chat"} first.</b>\n\n` +
          `You can only promote a ${isCh ? "channel" : "group"} where <b>@${bot}</b> is an administrator.\n\n` +
          `1. Tap the button below (or open the chat → Administrators → Add admin)\n` +
          `2. Add <b>@${bot}</b> and keep all suggested permissions on\n` +
          `3. You will come back here automatically and the setup will continue.`,
        {
          reply_markup: {
            inline_keyboard: [
              [
                {
                  text: "➕ Make Cool Gram admin",
                  url: `https://t.me/${bot}?${isCh ? "startchannel" : "startgroup"}&admin=${adminDeepLinkRights(isCh)}`,
                },
              ],
            ],
          },
        },
      );
      await supabase
        .from("cg_users")
        .update({ pending_action: `pick:${category}` })
        .eq("tg_id", chatId);
      return;
    }
    await recordBotChat(
      supabase,
      { id: shared.chat_id, title: shared.title, username: shared.username },
      st,
      chatId,
    );
  }



  const title = shared.title ?? "My channel";
  const link =
    (await joinableLink(shared.chat_id, shared.username)) ??
    `https://t.me/c/${String(shared.chat_id).replace("-100", "")}`;


  if (category.startsWith("boost_")) {
    if (!shared.username) {
      await send(
        chatId,
        "❌ This chat is private. Telegram Boost promotion needs a <b>public</b> channel or group (with an @link). Choose another one.",
      );
      await showBoostTypeMenu(supabase, chatId);
      return;
    }
    await showBoostDuration(supabase, chatId, {
      category: "boost",
      kind: category.slice(6),
      title,
      link,
      src_chat: shared.chat_id,
    });
    return;
  }

  const baseMin = category === "groups" ? cfg("min_group") : cfg("min_channel");

  await supabase
    .from("cg_users")
    .update({
      pending_action: `aud:${JSON.stringify({ category, title, link, base_min_price: baseMin, min_price: baseMin, src_chat: shared.chat_id })}`,
    })
    .eq("tg_id", chatId);

  await showAudienceMenu(chatId, "no restrictions", cfg("aud_surcharge"), `back:chatpick:${category}`);
}

async function showAudienceMenu(chatId: number, current: string, extra = cfg("aud_surcharge"), backTo = "promo_menu") {
  await send(
    chatId,
    `🎯 <b>Task audience</b>\nCurrent: ${current}\n\nChoose who can access the task:\n💡 The audience filter adds <b>+${extra} ${COIN}</b> to the min. price per completion.`,
    {
      reply_markup: {
        inline_keyboard: [
          [{ text: "🌐 Allow all", callback_data: "aud_all" }],
          [{ text: "🎯 Select audience", callback_data: "aud_pick" }],
          [{ text: "🔙 Back", callback_data: backTo }],
        ],
      },
    },
  );
}

const LANGS: { code: string; label: string }[] = [
  { code: "uk", label: "🇺🇦 Українська" },
  { code: "ru", label: "🇷🇺 Русский" },
  { code: "en", label: "🇬🇧 English" },
  { code: "de", label: "🇩🇪 Deutsch" },
  { code: "zh", label: "🇨🇳 中文" },
  { code: "ar", label: "🇸🇦 العربية" },
  { code: "fa", label: "🇮🇷 فارسی" },
  { code: "es", label: "🇪🇸 Español" },
  { code: "id", label: "🇮🇩 Bahasa Indonesia" },
  { code: "pt", label: "🇧🇷 Português" },
  { code: "hi", label: "🇮🇳 हिंदी" },
  { code: "bn", label: "🇧🇩 বাংলা" },
  { code: "uz", label: "🇺🇿 O'zbekcha" },
  { code: "tr", label: "🇹🇷 Türkçe" },
  { code: "kk", label: "🇰🇿 Қазақша" },
  { code: "fr", label: "🇫🇷 Français" },
];

async function showLanguageMenu(chatId: number, extra: number, selected: string[] = []) {
  const rows: any[] = [];
  for (let i = 0; i < LANGS.length; i += 3) {
    rows.push(
      LANGS.slice(i, i + 3).map((l) => ({
        text: selected.includes(l.code) ? `☑️ ${l.label}` : l.label,
        callback_data: `aud_set:${l.code}`,
      })),
    );
  }
  if (selected.length) rows.push([{ text: "✅ Save and continue", callback_data: "aud_save" }]);
  rows.push([{ text: "🔙 Back", callback_data: "aud_back" }]);
  const chosen = selected.length
    ? selected.map((c) => LANGS.find((l) => l.code === c)?.label ?? c).join("\n")
    : "no restrictions";
  await send(
    chatId,
    `• Audience:\n${chosen}\n\n🌐 <b>Choose one or more languages</b>\n💡 The audience filter adds <b>+${extra} ${COIN}</b> to the min. price per completion.`,
    { reply_markup: { inline_keyboard: rows } },
  );
}


function unitName(category: string) {
  if (category === "bots") return "1 bot visit";
  if (category === "views") return "1 post view";
  if (category === "reactions") return "1 reaction";
  if (category === "groups") return "1 group join";
  return "1 subscriber";
}

async function askPrice(supabase: ReturnType<typeof db>, chatId: number, info: any) {
  const min = Number(info.min_price ?? 1);
  const rec = Math.round(min * 1.2);
  await supabase
    .from("cg_users")
    .update({ pending_action: `price:${JSON.stringify(info)}` })
    .eq("tg_id", chatId);
  await send(
    chatId,
    `💲 <b>Set the price for ${unitName(info.category)}</b> — this is the worker's reward.\n\n` +
      `<blockquote>Minimum — <b>${min.toLocaleString("en-US")} ${COIN}</b>\n💡 Recommended — <b>${rec.toLocaleString("en-US")} ${COIN}</b>\nCompletion speed depends on your price.</blockquote>`,
    { reply_markup: { inline_keyboard: [[{ text: "⬅️ Back", callback_data: "aud_back" }]] } },
  );
}

function commission() {
  return cfg("commission_pct") / 100;
}

function unitCost(price: number) {
  return Math.ceil(price * (1 + commission()));
}

async function askCount(
  supabase: ReturnType<typeof db>,
  chatId: number,
  info: any,
  balance: number,
) {
  const price = Number(info.reward);
  const max = Math.floor(balance / unitCost(price));
  await supabase
    .from("cg_users")
    .update({ pending_action: `bud:${JSON.stringify(info)}` })
    .eq("tg_id", chatId);
  const rows: any[] = [];
  if (max >= 1) {
    rows.push([{ text: `${max.toLocaleString("en-US")} (Maximum for your balance)`, callback_data: "cnt_max" }]);
  }
  const isBoost = info.category === "boost";
  rows.push([{ text: "⬅️ Back", callback_data: isBoost ? "back:boostdur" : "aud_back" }]);
  await send(
    chatId,
    `ℹ️ <b>Task creation commission — ${cfg("commission_pct")}%.</b>\n\n` +
      `<blockquote>💲 ${isBoost ? "Telegram Boost price" : info.category === "bots" ? "Bot launch price" : "Task price"} — ${price.toLocaleString("en-US")} ${COIN}\n` +
      `💰 Your balance — ${balance.toLocaleString("en-US")} ${COIN}</blockquote>\n\n` +
      `📝 <b>Enter the number of ${isBoost ? "Telegram Boost" : "completions"} or choose:</b>`,
    { reply_markup: { inline_keyboard: rows } },
  );
}

async function createCampaign(
  supabase: ReturnType<typeof db>,
  chatId: number,
  info: any,
  count: number,
  balance: number,
) {
  const reward = Number(info.reward);
  const total = unitCost(reward) * count;
  if (balance < total) {
    await send(
      chatId,
      `❌ Insufficient balance. Required <b>${total.toLocaleString("en-US")} ${COIN}</b>, you have <b>${balance.toLocaleString("en-US")} ${COIN}</b>.`,
    );
    return;
  }
  await supabase.from("cg_ads").insert({
    boost_days: info.category === "boost" ? Number(info.days ?? 7) : null,
    owner_tg: chatId,
    title: info.title ?? "Promotion",
    link: info.link ?? "",
    reward,
    budget_left: reward * count,
    category: info.category,
    src_chat: info.src_chat ?? null,
    src_msg: info.src_msg ?? null,
    conditions: info.conditions ?? null,
    subtype:
      info.category === "bots"
        ? info.conditions
          ? "cond"
          : info.webapp
            ? "webapp"
            : "plain"
        : null,
  });
  await supabase
    .from("cg_users")
    .update({ balance: balance - total, pending_action: null })
    .eq("tg_id", chatId);
  await supabase
    .from("cg_transactions")
    .insert({ tg_id: chatId, amount: -total, reason: `Promotion: ${info.title ?? info.category}` });
  await send(
    chatId,
    `🚀 <b>Your campaign is live!</b>\n\n${info.title ?? ""}\nPrice: ${reward.toLocaleString("en-US")} ${COIN} × ${count}\nTotal (incl. ${cfg("commission_pct")}%): ${total.toLocaleString("en-US")} ${COIN}\nAudience: ${info.audience ?? "no restrictions"}`,
    { reply_markup: MAIN_KEYBOARD },
  );
}



async function askAmount(supabase: ReturnType<typeof db>, chatId: number, info: any) {
  await supabase
    .from("cg_users")
    .update({ pending_action: `amt:${JSON.stringify(info)}` })
    .eq("tg_id", chatId);
  await send(
    chatId,
    `✅ Selected: <b>${info.title}</b>\n${info.link}\n\nAudience: <b>${info.audience ?? "no restrictions"}</b>\n\nNow send the reward and budget:\n<code>Reward | Budget</code>\nExample: <code>5 | 100</code>`,
    { reply_markup: MAIN_KEYBOARD },
  );
}


// ---------------- Telegram Stars deposit ----------------
const STAR_PACKS = [50, 100, 250, 500, 1000];

async function showDepositMenu(supabase: ReturnType<typeof db>, chatId: number) {
  await supabase.from("cg_users").update({ pending_action: "stars" }).eq("tg_id", chatId);
  const rate = cfg("star_rate");
  const rows = [];
  for (let i = 0; i < STAR_PACKS.length; i += 2) {
    rows.push(
      STAR_PACKS.slice(i, i + 2).map((s) => ({
        text: `⭐ ${s} → ${(s * rate).toLocaleString("en-US")} ${COIN}`,
        callback_data: `dep:${s}`,
      })),
    );
  }
  rows.push([{ text: "🔙 Back", callback_data: "back" }]);
  await send(
    chatId,
    `⭐ <b>Deposit with Telegram Stars</b>\n\n` +
      `<blockquote>Rate: 1 ⭐ = <b>${rate.toLocaleString("en-US")} ${COIN}</b></blockquote>\n\n` +
      `Choose a pack or send the number of Stars you want to pay:`,
    { reply_markup: { inline_keyboard: rows } },
  );
}

async function sendStarsInvoice(chatId: number, stars: number) {
  const credit = stars * cfg("star_rate");
  const res = await tgRaw("sendInvoice", {
    chat_id: chatId,
    title: "COOL GRAM balance top-up",
    description: `${stars} Telegram Stars → ${credit.toLocaleString("en-US")} ${COIN}`,
    payload: `dep:${chatId}:${stars}`,
    currency: "XTR",
    prices: [{ label: `${stars} Stars`, amount: stars }],
  });
  if (!res?.ok) {
    await send(chatId, "❌ Could not create the Stars invoice. Please try again in a moment.");
  }
}

async function handleSuccessfulPayment(supabase: ReturnType<typeof db>, chatId: number, from: any, sp: any) {
  const stars = Number(sp.total_amount ?? 0);
  if (!stars) return;
  const credit = stars * cfg("star_rate");
  const username = from?.username ? `@${from.username}` : (from?.first_name ?? String(chatId));

  const { data: u } = await supabase
    .from("cg_users")
    .select("balance")
    .eq("tg_id", chatId)
    .maybeSingle();
  const balance = Number((u as any)?.balance ?? 0) + credit;

  await supabase
    .from("cg_users")
    .update({ balance, pending_action: null })
    .eq("tg_id", chatId);
  await supabase
    .from("cg_transactions")
    .insert({ tg_id: chatId, amount: credit, reason: `Deposit: ${stars} Telegram Stars` });
  await supabase.from("cg_star_payments").insert({
    tg_id: chatId,
    username: from?.username ?? null,
    stars,
    credited: credit,
    charge_id: sp.telegram_payment_charge_id ?? null,
  });

  await send(
    chatId,
    `✅ <b>Payment received!</b>\n\n⭐ Stars paid: <b>${stars}</b>\n💰 Credited: <b>+${credit.toLocaleString("en-US")} ${COIN}</b>\n💳 New balance: <b>${balance.toLocaleString("en-US")} ${COIN}</b>`,
  );

  await tgRaw("sendMessage", {
    chat_id: OWNER_TG,
    parse_mode: "HTML",
    text:
      `⭐ <b>New Stars deposit</b>\n\n` +
      `From: ${username} (<code>${chatId}</code>)\n` +
      `Stars: <b>${stars}</b>\n` +
      `Credited: <b>${credit.toLocaleString("en-US")} ${COIN}</b>\n\n` +
      `Owner account: @${OWNER_USERNAME}`,
  });
}

// ---------------- Admin panel ----------------
function isOwner(chatId: number) {
  return chatId === OWNER_TG;
}

async function showAdminPanel(supabase: ReturnType<typeof db>, chatId: number) {
  const users = await supabase.from("cg_users").select("id", { count: "exact", head: true });
  const ads = await supabase
    .from("cg_ads")
    .select("id", { count: "exact", head: true })
    .eq("is_active", true);
  const { data: stars } = await supabase.from("cg_star_payments").select("stars");
  const totalStars = ((stars ?? []) as any[]).reduce((a, r) => a + Number(r.stars), 0);

  const lines = Object.entries(SETTINGS).map(
    ([key, def]) => `<code>${key}</code> — ${def.label}: <b>${cfg(key).toLocaleString("en-US")}</b>`,
  );

  await send(
    chatId,
    `🛠 <b>Admin panel</b>\n\n` +
      `👥 Users: <b>${users.count ?? 0}</b>\n📢 Active campaigns: <b>${ads.count ?? 0}</b>\n⭐ Stars received: <b>${totalStars}</b>\n\n` +
      `<b>Current prices &amp; settings</b>\n${lines.join("\n")}\n\n` +
      `<b>Commands</b>\n` +
      `<code>/prices</code> — full price list with short names\n` +
      `<code>/setprice &lt;key&gt; &lt;value&gt;</code> — change any setting\n` +
      `<code>/resetprice &lt;key&gt;</code> — back to default (<code>all</code> resets everything)\n` +
      `<code>/addbalance &lt;tg_id&gt; &lt;amount&gt;</code> — add ${COIN} to a user\n` +
      `<code>/takebalance &lt;tg_id&gt; &lt;amount&gt;</code> — remove ${COIN}\n` +
      `<code>/resetbalance &lt;tg_id&gt;</code> — set balance to 0\n` +
      `<code>/block &lt;tg_id&gt; [reason]</code> — block a user from the bot\n` +
      `<code>/banfake &lt;tg_id&gt;</code> — ban for fake referrals: wallet 0, tasks stopped, warning sent\n` +
      `<code>/unblock &lt;tg_id&gt;</code> — unblock a user\n` +
      `<code>/blocked</code> — list blocked users\n` +
      `<code>/balances</code> — every user's balance (richest first)\n` +
      `<code>/find &lt;name or @username&gt;</code> — find a user's ID\n` +
      `<code>/userinfo &lt;tg_id&gt;</code> — user details\n` +
      `<code>/usertasks &lt;tg_id&gt;</code> — all campaigns of a user\n` +
      `<code>/alltasks</code> — campaigns of every user, top advertisers first\n` +
      `<code>/refs &lt;tg_id&gt;</code> — who a user invited (paid / pending)\n` +
      `<code>/refscan</code> — find fake-referral accounts\n` +
      `<code>/setprice ref_daily_max 20</code> — daily referral limit\n` +
      `<code>/setprice ref_task_gate 1</code> — tasks needed before bonus\n` +
      `<code>/deposits</code> — last Stars deposits\n` +
      `<code>/setprice withdraw &lt;amount&gt;</code> — minimum withdrawal\n` +
      `<code>/withdrawoff</code> / <code>/withdrawon</code> — close or open withdrawals\n` +
      `<code>/withdrawstatus</code> — current withdrawal status\n` +
      `<code>/chats</code> — every channel/group where the bot is admin\n` +
      `<code>/broadcast</code> — send any message (text/photo/video) to all those chats\n` +
      `<code>/broadcastall</code> — send any message to <b>all users</b> of the bot\n` +
      `<code>/status</code> — bot status &amp; task statistics\n\n` +
      `Examples:\n<code>/setprice channel 800</code>\n<code>/setprice group 600</code>\n<code>/setprice views 30</code>\n<code>/setprice bot 900</code>\n<code>/setprice premium 1400</code> — bot start, Premium-only audience\n<code>/setprice premium_cond 4000</code> — bot + conditions, Premium-only\n<code>/setprice reactions 25</code>\n<code>/setprice referral 600</code>`,
  );
}

function priceListText() {
  const aliasOf: Record<string, string[]> = {};
  for (const [alias, key] of Object.entries(SETTING_ALIASES)) {
    (aliasOf[key] ||= []).push(alias);
  }
  const lines = Object.entries(SETTINGS).map(([key, s]) => {
    const cur = cfg(key);
    const short = aliasOf[key]?.length ? ` (short: ${aliasOf[key]!.map((a) => `<code>${a}</code>`).join(", ")})` : "";
    const changed = cur !== s.def ? ` — default ${s.def.toLocaleString("en-US")}` : "";
    return `• ${s.label}\n  <code>${key}</code>${short}\n  Now: <b>${cur.toLocaleString("en-US")}</b>${changed}`;
  });
  return `💲 <b>Prices &amp; settings</b>\n\n${lines.join("\n\n")}\n\nChange: <code>/setprice &lt;key&gt; &lt;value&gt;</code>\nReset: <code>/resetprice &lt;key&gt;</code> or <code>/resetprice all</code>`;
}

const CATEGORY_LABELS: Record<string, string> = {
  channels: "📢 Channels",
  groups: "👥 Groups",
  views: "👁 Post views",
  bots: "🤖 Bots",
  reactions: "👍 Reactions",
  boost: "🚀 Telegram boost",
};

async function completionStats(supabase: ReturnType<typeof db>) {
  const [{ data: ads }, { data: comps }] = await Promise.all([
    supabase.from("cg_ads").select("id,category,is_active,budget_left,reward"),
    supabase.from("cg_completions").select("ad_id"),
  ]);
  const adRows = (ads ?? []) as any[];
  const catOf = new Map<string, string>();
  const active: Record<string, number> = {};
  for (const a of adRows) {
    const cat = String(a.category ?? "channels");
    catOf.set(String(a.id), cat);
    if (a.is_active) active[cat] = (active[cat] ?? 0) + 1;
  }
  const done: Record<string, number> = {};
  for (const c of (comps ?? []) as any[]) {
    const cat = catOf.get(String(c.ad_id));
    if (cat) done[cat] = (done[cat] ?? 0) + 1;
  }
  const total = ((comps ?? []) as any[]).length;
  return { done, active, total, ads: adRows.length };
}

function statsText(s: Awaited<ReturnType<typeof completionStats>>) {
  const lines = Object.entries(CATEGORY_LABELS).map(
    ([key, label]) =>
      `${label}\n   ✅ Completed: <b>${(s.done[key] ?? 0).toLocaleString("en-US")}</b>   •   🟢 Live tasks: <b>${(s.active[key] ?? 0).toLocaleString("en-US")}</b>`,
  );
  return `${lines.join("\n")}\n\n🏁 Total tasks completed: <b>${s.total.toLocaleString("en-US")}</b>`;
}

async function runBroadcast(
  supabase: ReturnType<typeof db>,
  chatId: number,
  payload: {
    text?: string;
    copyFrom?: { chat_id: number; message_id: number };
    target?: "chats" | "users";
  },
) {
  await supabase.from("cg_users").update({ pending_action: null }).eq("tg_id", chatId);
  const target = payload.target ?? "chats";
  let rows: { chat_id: number; title: string }[] = [];
  if (target === "users") {
    const { data: users } = await supabase.from("cg_users").select("tg_id,first_name,username");
    rows = ((users ?? []) as any[]).map((u) => ({
      chat_id: Number(u.tg_id),
      title: u.username ? `@${u.username}` : String(u.first_name ?? u.tg_id),
    }));
  } else {
    const { data: chats } = await supabase.from("cg_bot_chats").select("chat_id,title");
    rows = ((chats ?? []) as any[]).map((c) => ({
      chat_id: Number(c.chat_id),
      title: String(c.title ?? c.chat_id),
    }));
  }
  if (!rows.length) {
    await send(
      chatId,
      target === "users"
        ? "📭 There are no users to broadcast to yet."
        : "📭 The bot is not an admin in any chat yet, so there is nothing to broadcast to.",
    );
    return;
  }
  await send(chatId, `📡 Sending to <b>${rows.length}</b> ${target === "users" ? "users" : "chats"}…`);

  let sent = 0;
  const failed: string[] = [];
  const batchSize = target === "users" ? 25 : 1;
  for (let i = 0; i < rows.length; i += batchSize) {
    const batch = rows.slice(i, i + batchSize);
    const results = await Promise.all(
      batch.map((c) =>
        payload.copyFrom
          ? tgRaw("copyMessage", {
              chat_id: c.chat_id,
              from_chat_id: payload.copyFrom.chat_id,
              message_id: payload.copyFrom.message_id,
            })
          : tgRaw("sendMessage", {
              chat_id: c.chat_id,
              text: payload.text,
              parse_mode: "HTML",
              disable_web_page_preview: false,
            }),
      ),
    );
    results.forEach((res: any, idx) => {
      if (res?.ok) sent++;
      else failed.push(batch[idx]!.title);
    });
  }

  await send(
    chatId,
    `📡 <b>Broadcast finished</b>\n\n✅ Sent: <b>${sent}</b>\n❌ Failed: <b>${failed.length}</b>` +
      (failed.length ? `\n\nFailed:\n${failed.slice(0, 20).join("\n")}` : ""),
  );
}


async function handleAdminCommand(
  supabase: ReturnType<typeof db>,
  chatId: number,
  text: string,
): Promise<boolean> {
  if (!isOwner(chatId)) return false;
  const [cmdRaw, ...args] = text.split(/\s+/);
  const cmd = (cmdRaw ?? "").split("@")[0];

  if (cmd === "/admin") {
    await showAdminPanel(supabase, chatId);
    return true;
  }

  if (cmd === "/prices" || cmd === "/price") {
    await send(chatId, priceListText());
    return true;
  }

  if (cmd === "/chats") {
    const { data: chats } = await supabase
      .from("cg_bot_chats")
      .select("chat_id,title,username,type,status,added_by")
      .order("updated_at", { ascending: false })
      .limit(200);
    const rows = (chats ?? []) as any[];
    if (!rows.length) {
      await send(chatId, "📭 The bot is not an admin in any chat yet.");
      return true;
    }
    const lines = rows.map((c, i) => {
      const where = c.username ? `@${c.username}` : `<code>${c.chat_id}</code>`;
      return `${i + 1}. <b>${c.title ?? c.chat_id}</b>\n   ${where} — ${c.type ?? "chat"} (${c.status})`;
    });
    await send(
      chatId,
      `🛡 <b>Chats where Cool Gram is admin</b> (${rows.length})\n\n${lines.join("\n")}\n\nBroadcast to all of them: <code>/broadcast</code>`,
    );
    return true;
  }

  if (cmd === "/broadcastall" || cmd === "/broadcastusers") {
    const rest = text.slice(cmd.length).trim();
    if (rest) {
      await runBroadcast(supabase, chatId, { text: rest, target: "users" });
      return true;
    }
    await supabase.from("cg_users").update({ pending_action: "bcastall" }).eq("tg_id", chatId);
    await send(
      chatId,
      "📡 <b>Broadcast to all users</b>\n\nSend the next message (text, photo, video, or any media) and it will be delivered to every user of the bot.\n\nSend <code>/cancel</code> to stop.",
    );
    return true;
  }

  if (cmd === "/status") {
    const s = await completionStats(supabase);
    const [users, withdrawals, proofs] = await Promise.all([
      supabase.from("cg_users").select("id", { count: "exact", head: true }),
      supabase.from("cg_withdrawals").select("id", { count: "exact", head: true }).eq("status", "pending"),
      supabase.from("cg_proofs").select("id", { count: "exact", head: true }).eq("status", "pending"),
    ]);
    const { data: bals } = await supabase.from("cg_users").select("balance");
    const totalBal = ((bals ?? []) as any[]).reduce((a, r) => a + Number(r.balance ?? 0), 0);
    const { data: chats } = await supabase.from("cg_bot_chats").select("chat_id");
    await send(
      chatId,
      `🩺 <b>Bot status</b>\n\n` +
        `🟢 Bot: <b>online</b>\n` +
        `👥 Users: <b>${(users.count ?? 0).toLocaleString("en-US")}</b>\n` +
        `📢 Campaigns total: <b>${s.ads.toLocaleString("en-US")}</b>\n` +
        `💰 Coins in user balances: <b>${totalBal.toLocaleString("en-US")} ${COIN}</b>\n` +
        `💸 Pending withdrawals: <b>${withdrawals.count ?? 0}</b> (${withdrawOpen() ? "OPEN" : "CLOSED"})\n` +
        `📸 Proofs waiting for review: <b>${proofs.count ?? 0}</b>\n` +
        `🛡 Admin chats: <b>${((chats ?? []) as any[]).length}</b>\n\n` +
        `<b>Tasks</b>\n${statsText(s)}`,
    );
    return true;
  }

  if (cmd === "/broadcast") {
    const rest = text.slice(cmd.length).trim();
    if (rest) {
      await runBroadcast(supabase, chatId, { text: rest });
      return true;
    }
    await supabase.from("cg_users").update({ pending_action: "bcast" }).eq("tg_id", chatId);
    await send(
      chatId,
      "📡 <b>Broadcast mode</b>\n\nSend the next message (text, photo, video, or any media) and it will be posted to every chat where the bot is an admin.\n\nSend <code>/cancel</code> to stop.",
    );
    return true;
  }


  if (cmd === "/cancel") {
    await supabase.from("cg_users").update({ pending_action: null }).eq("tg_id", chatId);
    await send(chatId, "✅ Cancelled.");
    return true;
  }

  if (cmd === "/withdrawoff" || cmd === "/withdrawon" || cmd === "/withdrawstatus") {
    if (cmd === "/withdrawstatus") {
      await send(
        chatId,
        `💸 Withdrawals are currently <b>${withdrawOpen() ? "OPEN" : "CLOSED"}</b>.\nMinimum: <b>${cfg("min_withdraw").toLocaleString("en-US")} ${COIN}</b>\n\n<code>/withdrawoff</code> — close\n<code>/withdrawon</code> — open\n<code>/setprice withdraw 50000</code> — minimum amount`,
      );
      return true;
    }
    const open = cmd === "/withdrawon" ? 1 : 0;
    await supabase
      .from("cg_settings")
      .upsert({ key: "withdraw_open", value: open, updated_at: new Date().toISOString() });
    settingsMap["withdraw_open"] = open;
    await send(
      chatId,
      open
        ? "✅ Withdrawals are now <b>OPEN</b> for all users."
        : "🚧 Withdrawals are now <b>CLOSED</b>. Users will see: “Withdrawals are temporarily closed. They will open again soon.”",
    );
    return true;
  }

  if (cmd === "/setprice") {
    const key = settingKey(args[0] ?? "");
    const value = Number(String(args[1] ?? "").replace(/[, _]/g, ""));
    if (!key || !Number.isFinite(value) || value < 0) {
      await send(
        chatId,
        `⚠️ Use: <code>/setprice &lt;key&gt; &lt;value&gt;</code>\n` +
          `Examples: <code>/setprice channel 800</code>, <code>/setprice referral 600</code>\n\n` +
          `Send <code>/prices</code> to see every key.`,
      );
      return true;
    }
    await supabase.from("cg_settings").upsert({ key, value, updated_at: new Date().toISOString() });
    settingsMap[key] = value;
    await send(
      chatId,
      `✅ <b>${SETTINGS[key]!.label}</b> updated to <b>${value.toLocaleString("en-US")}</b>.\nKey: <code>${key}</code>`,
    );
    return true;
  }

  if (cmd === "/resetprice") {
    const raw = (args[0] ?? "").toLowerCase();
    if (raw === "all") {
      for (const key of Object.keys(SETTINGS)) {
        await supabase.from("cg_settings").delete().eq("key", key);
        delete settingsMap[key];
      }
      await send(chatId, "♻️ All prices reset to their defaults.");
      return true;
    }
    const key = settingKey(raw);
    if (!key) {
      await send(chatId, "⚠️ Unknown key. Send <code>/prices</code> to see all keys.");
      return true;
    }
    await supabase.from("cg_settings").delete().eq("key", key);
    delete settingsMap[key];
    await send(
      chatId,
      `♻️ <b>${SETTINGS[key]!.label}</b> reset to default <b>${SETTINGS[key]!.def.toLocaleString("en-US")}</b>.`,
    );
    return true;
  }


  if (cmd === "/addbalance" || cmd === "/takebalance") {
    const target = Number(args[0]);
    const amountRaw = Number(args[1]);
    if (!Number.isFinite(target) || !Number.isFinite(amountRaw) || amountRaw <= 0) {
      await send(chatId, `⚠️ Use: <code>${cmd} &lt;tg_id&gt; &lt;amount&gt;</code>`);
      return true;
    }
    const amount = cmd === "/addbalance" ? Math.floor(amountRaw) : -Math.floor(amountRaw);
    const { data: u } = await supabase
      .from("cg_users")
      .select("balance")
      .eq("tg_id", target)
      .maybeSingle();
    if (!u) {
      await send(chatId, "❌ This user has not started the bot yet.");
      return true;
    }
    const balance = Math.max(0, Number((u as any).balance) + amount);
    await supabase.from("cg_users").update({ balance }).eq("tg_id", target);
    await supabase
      .from("cg_transactions")
      .insert({ tg_id: target, amount, reason: amount > 0 ? "Admin top-up" : "Admin adjustment" });
    await send(
      chatId,
      `✅ User <code>${target}</code> balance is now <b>${balance.toLocaleString("en-US")} ${COIN}</b>.`,
    );
    await tgRaw("sendMessage", {
      chat_id: target,
      parse_mode: "HTML",
      text:
        amount > 0
          ? `💰 <b>+${amount.toLocaleString("en-US")} ${COIN}</b> added to your balance by the admin.\nNew balance: <b>${balance.toLocaleString("en-US")} ${COIN}</b>`
          : `ℹ️ Your balance was adjusted by the admin.\nNew balance: <b>${balance.toLocaleString("en-US")} ${COIN}</b>`,
    });
    return true;
  }

  if (cmd === "/resetbalance" || cmd === "/zerobalance") {
    const target = Number(args[0]);
    if (!Number.isFinite(target)) {
      await send(chatId, `⚠️ Use: <code>${cmd} &lt;tg_id&gt;</code>`);
      return true;
    }
    const { data: u } = await supabase
      .from("cg_users")
      .select("balance")
      .eq("tg_id", target)
      .maybeSingle();
    if (!u) {
      await send(chatId, "❌ This user has not started the bot yet.");
      return true;
    }
    const old = Number((u as any).balance) || 0;
    await supabase.from("cg_users").update({ balance: 0 }).eq("tg_id", target);
    if (old > 0) {
      await supabase
        .from("cg_transactions")
        .insert({ tg_id: target, amount: -old, reason: "Admin balance reset" });
    }
    await send(
      chatId,
      `✅ User <code>${target}</code> balance reset to <b>0 ${COIN}</b> (was ${old.toLocaleString("en-US")}).`,
    );
    await tgRaw("sendMessage", {
      chat_id: target,
      parse_mode: "HTML",
      text: `ℹ️ Your balance was reset to <b>0 ${COIN}</b> by the administrator.`,
    });
    return true;
  }

  if (cmd === "/block" || cmd === "/unblock" || cmd === "/banfake" || cmd === "/fakeban" || cmd === "/banrefer") {
    const target = Number(args[0]);
    if (!Number.isFinite(target)) {
      await send(chatId, `⚠️ Use: <code>${cmd} &lt;tg_id&gt;</code>`);
      return true;
    }
    if (target === OWNER_TG) {
      await send(chatId, "⚠️ You cannot block yourself.");
      return true;
    }
    const fake = cmd === "/banfake" || cmd === "/fakeban" || cmd === "/banrefer";
    const block = cmd === "/block" || fake;
    const reason = args.slice(1).join(" ").trim();
    const { data: u } = await supabase
      .from("cg_users")
      .select("tg_id, balance")
      .eq("tg_id", target)
      .maybeSingle();
    if (!u) {
      await send(chatId, "❌ This user has not started the bot yet.");
      return true;
    }
    const oldBal = Number((u as any).balance ?? 0);
    const wipe = fake || (block && (reason.toLowerCase().includes("fake") || args.includes("wipe")));
    await supabase
      .from("cg_users")
      .update({ blocked: block, pending_action: null, ...(wipe ? { balance: 0 } : {}) })
      .eq("tg_id", target);
    if (wipe && oldBal > 0) {
      await supabase.from("cg_transactions").insert({
        tg_id: target,
        amount: -oldBal,
        reason: fake ? "Ban: fake referrals — wallet cleared" : "Ban: wallet cleared",
      });
    }
    blockCache.set(target, { v: block, t: Date.now() });
    // Stop / resume all campaigns of this advertiser
    const { data: ownAds } = await supabase
      .from("cg_ads")
      .select("id, reward, budget_left, is_active")
      .eq("owner_tg", target)
      .limit(500);
    let touched = 0;
    for (const a of (ownAds ?? []) as any[]) {
      if (block) {
        if (!a.is_active) continue;
        await supabase.from("cg_ads").update({ is_active: false }).eq("id", a.id);
        touched++;
      } else {
        if (a.is_active) continue;
        if (Number(a.budget_left) < Number(a.reward)) continue;
        await supabase.from("cg_ads").update({ is_active: true }).eq("id", a.id);
        touched++;
      }
    }
    await send(
      chatId,
      block
        ? `🚫 User <code>${target}</code> is now <b>blocked</b>.\n⏸ Campaigns stopped: <b>${touched}</b>${wipe ? `\n👛 Wallet cleared: <b>${oldBal.toLocaleString("en-US")} ${COIN}</b> removed` : ""}${fake ? "\n🚩 Reason: fake referrals" : reason ? `\nReason: ${reason}` : ""}`
        : `✅ User <code>${target}</code> is <b>unblocked</b>.\n▶️ Campaigns resumed: <b>${touched}</b>`,
    );
    const fakeMsg =
      `🚩 <b>Account banned — fake referrals</b>\n\n` +
      `⚠️ Our system found that you invited fake or self-created accounts to farm referral rewards. This breaks the Cool Gram rules.\n\n` +
      `What happened:\n` +
      `• 🚫 Your account is blocked\n` +
      `• 👛 Your wallet has been set to <b>0 ${COIN}</b>\n` +
      `• ⏸ All your campaigns have been stopped\n\n` +
      `⚠️ <b>Warning:</b> Creating fake accounts again will make this ban permanent and any future balance will be removed as well.\n\n` +
      `If you believe this is a mistake, contact support.`;
    await tgRaw("sendMessage", {
      chat_id: target,
      parse_mode: "HTML",
      text: block
        ? fake
          ? fakeMsg
          : `${BLOCKED_MSG}${wipe ? `\n\n👛 Your wallet has been set to 0 ${COIN}.` : ""}${reason ? `\n\nReason: ${reason}` : ""}`
        : "✅ <b>You are unblocked</b>\n\nYou can use Cool Gram again. Send /start to continue.",
    });
    return true;
  }

  if (cmd === "/blocked") {
    const { data } = await supabase
      .from("cg_users")
      .select("tg_id, username, first_name, balance")
      .eq("blocked", true)
      .limit(50);
    const rows = ((data ?? []) as any[]).map(
      (r) =>
        `🚫 <code>${r.tg_id}</code> ${r.username ? `@${r.username}` : (r.first_name ?? "")} — ${Number(r.balance ?? 0).toLocaleString("en-US")} ${COIN}`,
    );
    await send(
      chatId,
      rows.length
        ? `🚫 <b>Blocked users (${rows.length})</b>\n\n${rows.join("\n")}\n\nUnblock: <code>/unblock &lt;tg_id&gt;</code>`
        : "✅ No blocked users.",
    );
    return true;
  }

  if (
    cmd === "/balances" ||
    cmd === "/balanceall" ||
    cmd === "/wallets" ||
    cmd === "/allbalance"
  ) {
    const minRaw = args[0] ? Number(String(args[0]).replace(/[_,]/g, "")) : NaN;
    const min = Number.isFinite(minRaw) && minRaw > 0 ? minRaw : 0;
    let query = supabase
      .from("cg_users")
      .select("tg_id, username, first_name, balance, blocked")
      .order("balance", { ascending: false })
      .limit(min ? 100 : 50);
    if (min) query = query.gte("balance", min);
    const [{ data }, { data: allBals }] = await Promise.all([
      query,
      supabase.from("cg_users").select("balance"),
    ]);
    const list = (data ?? []) as any[];
    const totalBal = ((allBals ?? []) as any[]).reduce(
      (a, r) => a + Number(r.balance ?? 0),
      0,
    );
    const totalUsers = ((allBals ?? []) as any[]).length;
    const rows = list.map(
      (r, i) =>
        `${i + 1}. <code>${r.tg_id}</code> ${r.username ? `@${r.username}` : (r.first_name ?? "")}${r.blocked ? " 🚫" : ""} — <b>${Number(r.balance ?? 0).toLocaleString("en-US")}</b> ${COIN}`,
    );
    const shown = list.reduce((a, r) => a + Number(r.balance ?? 0), 0);
    await send(
      chatId,
      list.length
        ? `💰 <b>User balances${min ? ` — ${min.toLocaleString("en-US")} ${COIN}+` : " (richest first)"}</b>\n\n` +
            `${rows.join("\n")}\n\n` +
            `${min ? `👥 Matching users: <b>${list.length}</b> of <b>${totalUsers.toLocaleString("en-US")}</b>\n` : ""}` +
            `📊 Shown coins: <b>${shown.toLocaleString("en-US")} ${COIN}</b>\n` +
            `🏦 All balances: <b>${totalBal.toLocaleString("en-US")} ${COIN}</b> (${totalUsers.toLocaleString("en-US")} users)\n\n` +
            `Filter: <code>/balances 10000</code> — only users with 10,000 ${COIN}+`
        : min
          ? `🔎 No user has <b>${min.toLocaleString("en-US")} ${COIN}</b> or more.`
          : "👥 No users yet.",
    );
    return true;
  }

  if (cmd === "/refs") {
    const target = Number(args[0]);
    if (!Number.isFinite(target)) {
      await send(chatId, "⚠️ Use: <code>/refs &lt;tg_id&gt;</code>");
      return true;
    }
    const { data } = await supabase
      .from("cg_users")
      .select("tg_id, username, first_name, ref_paid, created_at")
      .eq("referred_by", target)
      .limit(60);
    const list = (data ?? []) as any[];
    const paid = list.filter((r) => r.ref_paid).length;
    const rows = list
      .slice(0, 40)
      .map(
        (r) =>
          `${r.ref_paid ? "✅" : "⏳"} <code>${r.tg_id}</code> ${r.username ? `@${r.username}` : (r.first_name ?? "")}`,
      );
    await send(
      chatId,
      `🔗 <b>Referrals of ${target}</b>\n\nTotal: <b>${list.length}</b> • Paid: <b>${paid}</b> • Pending: <b>${list.length - paid}</b>\n\n${rows.join("\n") || "None."}`,
    );
    return true;
  }

  if (cmd === "/refscan") {
    const { data } = await supabase
      .from("cg_users")
      .select("tg_id, username, first_name, referral_count")
      .order("referral_count", { ascending: false })
      .limit(15);
    const rows: string[] = [];
    for (const r of ((data ?? []) as any[]).filter((r) => Number(r.referral_count) > 0)) {
      const { data: invited } = await supabase
        .from("cg_users")
        .select("tg_id")
        .eq("referred_by", r.tg_id)
        .limit(200);
      const ids = ((invited ?? []) as any[]).map((i) => Number(i.tg_id));
      let active = 0;
      for (const id of ids.slice(0, 60)) {
        const { count } = await supabase
          .from("cg_completions")
          .select("id", { count: "exact", head: true })
          .eq("tg_id", id);
        if ((count ?? 0) > 0) active += 1;
      }
      const checked = Math.min(ids.length, 60);
      const ratio = checked ? Math.round((active / checked) * 100) : 0;
      rows.push(
        `${ratio < 30 && checked >= 5 ? "🚩" : "👤"} <code>${r.tg_id}</code> ${r.username ? `@${r.username}` : ""} — invites ${ids.length}, active ${active}/${checked} (${ratio}%)`,
      );
    }
    await send(
      chatId,
      `🕵️ <b>Referral fraud scan</b>\n\n${rows.join("\n") || "No referrals yet."}\n\n🚩 = most invited users never did a task (likely fake).\nBlock with <code>/block &lt;tg_id&gt; reason</code>.`,
    );
    return true;
  }


  if (cmd === "/find" || cmd === "/search" || cmd === "/user") {
    const q = args.join(" ").trim().toLowerCase().replace(/^@/, "");
    if (!q) {
      await send(
        chatId,
        "⚠️ Use: <code>/find &lt;name or @username&gt;</code>\nExample: <code>/find Rahul</code> or <code>/find rahul_07</code>",
      );
      return true;
    }
    const { data: all } = await supabase
      .from("cg_users")
      .select("tg_id, username, first_name, balance, created_at")
      .order("created_at", { ascending: false })
      .limit(3000);
    const hits = ((all ?? []) as any[])
      .filter(
        (u) =>
          String(u.tg_id).includes(q) ||
          String(u.username ?? "").toLowerCase().includes(q) ||
          String(u.first_name ?? "").toLowerCase().includes(q),
      )
      .slice(0, 30);
    if (!hits.length) {
      await send(chatId, `❌ No user matches <b>${q}</b>.\n\nEvery user can send you their ID with <code>/myid</code>.`);
      return true;
    }
    const rows = hits.map(
      (u) =>
        `👤 <b>${(u.first_name ?? "User").replace(/[<>]/g, "")}</b> ${u.username ? `@${u.username}` : ""}\nID: <code>${u.tg_id}</code> — ${Number(u.balance ?? 0).toLocaleString("en-US")} ${COIN}`,
    );
    await send(
      chatId,
      `🔎 <b>Matches for "${q.replace(/[<>]/g, "")}"</b> (${hits.length})\n\n${rows.join("\n\n")}\n\nUse: <code>/userinfo &lt;id&gt;</code> · <code>/addbalance &lt;id&gt; &lt;amount&gt;</code> · <code>/block &lt;id&gt;</code>`,
    );
    return true;
  }

  if (cmd === "/userinfo") {
    const target = Number(args[0]);
    if (!Number.isFinite(target)) {
      await send(chatId, "⚠️ Use: <code>/userinfo &lt;tg_id&gt;</code>");
      return true;
    }
    const { data: u } = await supabase
      .from("cg_users")
      .select("tg_id, username, first_name, balance, referral_count, created_at")
      .eq("tg_id", target)
      .maybeSingle();
    if (!u) {
      await send(chatId, "❌ User not found.");
      return true;
    }
    const x = u as any;
    await send(
      chatId,
      `👤 <b>${x.first_name ?? "User"}</b> ${x.username ? `@${x.username}` : ""}\nID: <code>${x.tg_id}</code>\nBalance: <b>${Number(x.balance).toLocaleString("en-US")} ${COIN}</b>\nReferrals: <b>${x.referral_count}</b>\nJoined: ${new Date(x.created_at).toDateString()}`,
    );
    return true;
  }

  if (cmd === "/usertasks" || cmd === "/tasks") {
    const target = Number(args[0]);
    if (!Number.isFinite(target)) {
      await send(chatId, "⚠️ Use: <code>/usertasks &lt;tg_id&gt;</code>");
      return true;
    }
    const { data: ads } = await supabase
      .from("cg_ads")
      .select("id, title, category, reward, budget_left, is_active, created_at")
      .eq("owner_tg", target)
      .order("created_at", { ascending: false })
      .limit(50);
    const list = (ads ?? []) as any[];
    const { user: u } = await getUser(supabase, target);
    if (!list.length) {
      await send(chatId, `📋 <b>${(u as any).first_name ?? "User"}</b> (<code>${target}</code>) has no campaigns.`);
      return true;
    }
    const { data: comps } = await supabase
      .from("cg_completions")
      .select("ad_id")
      .in(
        "ad_id",
        list.map((a) => a.id),
      );
    const doneOf = new Map<string, number>();
    for (const c of (comps ?? []) as any[]) {
      doneOf.set(String(c.ad_id), (doneOf.get(String(c.ad_id)) ?? 0) + 1);
    }
    let sumQty = 0;
    let sumDone = 0;
    const lines = list.map((a, i) => {
      const label = CATEGORY_LABELS[a.category] ?? a.category;
      const status = a.is_active ? "🟢 Live" : "🔴 Off";
      const left = a.reward > 0 ? Math.floor(Number(a.budget_left) / Number(a.reward)) : 0;
      const done = doneOf.get(String(a.id)) ?? 0;
      const qty = done + left;
      sumQty += qty;
      sumDone += done;
      return `${i + 1}. ${status} ${label} — <b>${a.title}</b>\n   ✖️ Quantity: <b>${qty}x</b> • ✅ Done: ${done} • ⏳ Left: ${left}\n   💰 ${Number(a.reward).toLocaleString("en-US")} ${COIN} each`;
    });
    const active = list.filter((a) => a.is_active).length;
    await send(
      chatId,
      `📋 <b>Campaigns by ${(u as any).first_name ?? "User"}</b> (<code>${target}</code>)\nTotal: <b>${list.length}</b> • 🟢 Live: <b>${active}</b>\nOrdered quantity: <b>${sumQty}x</b> • ✅ Done: <b>${sumDone}</b> • ⏳ Left: <b>${sumQty - sumDone}</b>\n\n${lines.join("\n\n")}`,
    );
    return true;
  }

  if (cmd === "/alltasks" || cmd === "/taskusers") {
    const [{ data: ads }, { data: allComps }] = await Promise.all([
      supabase.from("cg_ads").select("id, owner_tg, category, is_active, reward, budget_left").limit(2000),
      supabase.from("cg_completions").select("ad_id").limit(20000),
    ]);
    const all = ((ads ?? []) as any[]).filter((a) => a.is_active === true);
    if (!all.length) {
      await send(chatId, "📋 No live campaigns right now.");
      return true;
    }
    const doneOf = new Map<string, number>();
    for (const c of (allComps ?? []) as any[]) {
      doneOf.set(String(c.ad_id), (doneOf.get(String(c.ad_id)) ?? 0) + 1);
    }
    const byOwner = new Map<
      number,
      { total: number; live: number; qty: number; done: number; cats: Map<string, number> }
    >();
    let grandQty = 0;
    for (const a of all) {
      const o = Number(a.owner_tg);
      if (!byOwner.has(o)) byOwner.set(o, { total: 0, live: 0, qty: 0, done: 0, cats: new Map() });
      const e = byOwner.get(o)!;
      e.total++;
      if (a.is_active) e.live++;
      const left = Number(a.reward) > 0 ? Math.floor(Number(a.budget_left) / Number(a.reward)) : 0;
      const done = doneOf.get(String(a.id)) ?? 0;
      e.qty += left + done;
      e.done += done;
      grandQty += left + done;
      e.cats.set(a.category, (e.cats.get(a.category) ?? 0) + 1);
    }
    const top = [...byOwner.entries()].sort((a, b) => b[1].total - a[1].total).slice(0, 25);
    const ids = top.map(([id]) => id);
    const { data: users } = await supabase
      .from("cg_users")
      .select("tg_id, username, first_name")
      .in("tg_id", ids);
    const nameOf = new Map<number, string>();
    for (const u of (users ?? []) as any[]) {
      nameOf.set(Number(u.tg_id), u.username ? `@${u.username}` : (u.first_name ?? "User"));
    }
    const lines = top.map(([id, e], i) => {
      const cats = [...e.cats.entries()]
        .sort((a, b) => b[1] - a[1])
        .map(([c, n]) => `${(CATEGORY_LABELS[c] ?? c).replace(/^\S+\s/, "")} ×${n}`)
        .join(", ");
      const medal = i === 0 ? "🥇" : i === 1 ? "🥈" : i === 2 ? "🥉" : `${i + 1}.`;
      return `${medal} <b>${nameOf.get(id) ?? "User"}</b> (<code>${id}</code>)\n   🟢 ${e.total} live task(s)\n   ✖️ Quantity: <b>${e.qty}x</b> • ✅ Done: ${e.done}\n   ${cats}`;
    });
    await send(
      chatId,
      `🟢 <b>Live campaigns by user</b>\nLive campaigns: <b>${all.length}</b> • Advertisers: <b>${byOwner.size}</b>\nTotal ordered quantity: <b>${grandQty}x</b>\n(Sorted: most tasks first)\n\n${lines.join("\n\n")}\n\n🔍 Details: <code>/usertasks &lt;tg_id&gt;</code>`,
    );
    return true;
  }

  if (cmd === "/deposits") {
    const { data } = await supabase
      .from("cg_star_payments")
      .select("tg_id, username, stars, credited, created_at")
      .order("created_at", { ascending: false })
      .limit(15);
    const rows = ((data ?? []) as any[]).map(
      (r) =>
        `⭐ ${r.stars} → ${Number(r.credited).toLocaleString("en-US")} ${COIN} — ${r.username ? `@${r.username}` : r.tg_id}`,
    );
    await send(chatId, `⭐ <b>Last Stars deposits</b>\n\n${rows.length ? rows.join("\n") : "No deposits yet."}`);
    return true;
  }

  return false;
}

async function handleProofPhoto(
  supabase: ReturnType<typeof db>,
  chatId: number,
  message: any,
  adId: string,
) {
  const photos = message?.photo ?? [];
  const fileId = photos.length ? photos[photos.length - 1].file_id : null;
  if (!fileId) {
    await send(chatId, "\u26a0\ufe0f Please send a photo (screenshot) as proof.");
    return;
  }
  const { data: ad } = await supabase
    .from("cg_ads")
    .select("id, title, link, reward, budget_left, is_active, owner_tg, conditions, category")
    .eq("id", adId)
    .maybeSingle();

  await supabase.from("cg_users").update({ pending_action: null }).eq("tg_id", chatId);
  if (!ad || !(ad as any).is_active) {
    await send(chatId, "\u274c This task is no longer available.");
    return;
  }
  const { data: u } = await supabase
    .from("cg_users")
    .select("username, first_name")
    .eq("tg_id", chatId)
    .maybeSingle();
  const uname = (u as any)?.username ? `@${(u as any).username}` : ((u as any)?.first_name ?? "User");
  const caption =
    `\ud83d\udcf8 <b>New task proof</b>\n\n` +
    `Task: <b>${(ad as any).title}</b>\n` +
    `Conditions: ${(ad as any).conditions ?? "-"}\n` +
    `Worker: ${uname} (<code>${chatId}</code>)\n` +
    `Reward: <b>${Number((ad as any).reward).toLocaleString("en-US")} ${COIN}</b>\n\n` +
    `\u26a0\ufe0f <b>Warning:</b> Reject only if the proof is fake or incomplete. Every rejection is reviewed by the admin, and if the worker had really completed the conditions a penalty of <b>${Number((ad as any).reward).toLocaleString("en-US")} ${COIN}</b> can be deducted from your balance.`;
  const markup = {
    inline_keyboard: [
      [
        { text: "\u2705 Approve", callback_data: `papv:${adId}:${chatId}` },
        { text: "\u274c Reject", callback_data: `prej:${adId}:${chatId}` },
      ],
    ],
  };
  const targets = [Number((ad as any).owner_tg), OWNER_TG].filter(
    (t, i, arr) => Number.isFinite(t) && arr.indexOf(t) === i,
  );
  for (const target of targets) {
    await tgRaw("sendPhoto", {
      chat_id: target,
      photo: fileId,
      caption,
      parse_mode: "HTML",
      reply_markup: markup,
    });
  }
  await supabase
    .from("cg_proofs")
    .upsert(
      {
        ad_id: adId,
        tg_id: chatId,
        file_id: fileId,
        status: "pending",
        created_at: new Date().toISOString(),
        resolved_at: null,
      } as any,
      { onConflict: "ad_id,tg_id" },
    );

  const cat = String((ad as any).category ?? "");
  const nextLabel =
    cat === "bots"
      ? "\u27a1\ufe0f Next Bot"
      : cat === "channels"
        ? "\u27a1\ufe0f Next Channel"
        : cat === "groups"
          ? "\u27a1\ufe0f Next Group"
          : "\u27a1\ufe0f Next Task";
  await send(
    chatId,
    `\u2705 Your completion has been sent to the author for review.\n` +
      `\u23f3 If it is not reviewed within <b>24 hours</b> — payment will be made automatically.\n\n` +
      `Task: <b>${(ad as any).title}</b>\nReward: <b>${Number((ad as any).reward).toLocaleString("en-US")} ${COIN}</b>`,
    {
      reply_markup: {
        inline_keyboard: [
          [{ text: nextLabel, callback_data: cat ? `cat:${cat}` : "earn" }],
          [{ text: "\ud83d\udd19 Back", callback_data: "earn" }],
        ],
      },
    },
  );
}


async function handleText(supabase: ReturnType<typeof db>, chatId: number, from: any, text: string) {
  const startPayload = text.startsWith("/start") ? text.split(" ")[1] : undefined;
  const { user, isNew } = await getUser(supabase, from, startPayload);
  const bot = await botUsername();

  if (text.startsWith("/") && (await handleAdminCommand(supabase, chatId, text))) return;

  if (/^\/(myid|id|whoami)\b/i.test(text.trim())) {
    const id = Number(from?.id ?? chatId);
    await send(
      chatId,
      `🆔 <b>Your ID</b>\n\n<code>${id}</code>\n\nSend this number to the Cool Gram team whenever they ask for your ID.`,
    );
    return;
  }


  if (await isBlocked(supabase, Number(from?.id ?? chatId))) {
    await send(chatId, BLOCKED_MSG);
    return;
  }

  if (!(await sponsorGate(Number(from?.id ?? chatId), chatId))) return;

  if (text.startsWith("/deposit")) {
    await showDepositMenu(supabase, chatId);
    return;
  }

  if (user?.pending_action === "stars" && /^\d+$/.test(text.trim())) {
    const stars = Number(text.trim());
    if (stars < 1 || stars > 100000) {
      await send(chatId, "⚠️ Enter a number of Stars between 1 and 100000.");
      return;
    }
    await supabase.from("cg_users").update({ pending_action: null }).eq("tg_id", chatId);
    await sendStarsInvoice(chatId, stars);
    return;
  }

  if (user?.pending_action === "withdraw" && /^\d+$/.test(text.trim())) {
    if (!withdrawOpen()) {
      await supabase.from("cg_users").update({ pending_action: null }).eq("tg_id", chatId);
      await send(chatId, WITHDRAW_CLOSED_MSG);
      return;
    }
    const amount = Number(text.trim());
    const min = cfg("min_withdraw");
    if (amount < min) {
      await send(chatId, `⚠️ Minimum withdrawal is <b>${min.toLocaleString("en-US")} ${COIN}</b>.`);
      return;
    }
    if (amount > Number(user.balance)) {
      await send(chatId, `⚠️ Not enough balance. You have <b>${user.balance} ${COIN}</b>.`);
      return;
    }
    await supabase
      .from("cg_users")
      .update({ balance: Number(user.balance) - amount, pending_action: null })
      .eq("tg_id", chatId);
    await supabase.from("cg_transactions").insert({
      tg_id: chatId,
      amount: -amount,
      reason: "Withdrawal request",
    });
    const uname = (user as any).username as string | undefined;
    const { data: wd } = await supabase
      .from("cg_withdrawals")
      .insert({ tg_id: chatId, username: uname ?? null, amount, status: "pending" })
      .select("id")
      .single();
    await send(
      chatId,
      `✅ <b>Withdrawal requested</b>\n\nAmount: <b>${amount.toLocaleString("en-US")} ${COIN}</b>\nYour request is being processed. The admin will contact you shortly.`,
    );
    const mention = `<a href="tg://user?id=${chatId}">${uname ? "@" + uname : "User " + chatId}</a>`;
    await send(
      OWNER_TG,
      `💸 <b>New withdrawal request</b>\n\nUser: ${mention}\nID: <code>${chatId}</code>\nAmount: <b>${amount.toLocaleString("en-US")} ${COIN}</b>\nBalance left: <b>${(Number(user.balance) - amount).toLocaleString("en-US")} ${COIN}</b>`,
      {
        reply_markup: {
          inline_keyboard: [
            [{ text: "✅ Mark as Paid", callback_data: `wd:ok:${wd?.id}` }],
            [{ text: "❌ Reject & refund", callback_data: `wd:no:${wd?.id}` }],
          ],
        },
      },
    );

    return;
  }



  const isMenu = MAIN_KEYBOARD.keyboard.flat().some((b) => b.text === text);
  if (isMenu && user?.pending_action) {
    await supabase.from("cg_users").update({ pending_action: null }).eq("tg_id", chatId);
    (user as any).pending_action = null;
  }

  if (text === "🔙 Back" || text === "⬅️ Back" || text === "🏠 Main menu") {
    const prev = (user as any)?.pending_action as string | null;
    await supabase.from("cg_users").update({ pending_action: null }).eq("tg_id", chatId);
    if (text !== "🏠 Main menu" && (prev === "botlink" || prev === "botlinkwa")) {
      await showBotPromoInfo(supabase, chatId, prev === "botlinkwa");
      return;
    }
    await showPromoteMenu(supabase, chatId);
    return;
  }

  if (
    (user?.pending_action === "botlink" || user?.pending_action === "botlinkwa") &&
    !isMenu &&
    !text.startsWith("/")
  ) {
    const waMode = user.pending_action === "botlinkwa";
    const raw = text.trim();
    const uname = raw.replace(/^https?:\/\/t\.me\//i, "").replace(/^@/, "").split(/[/?\s]/)[0] ?? "";
    if (!/^[A-Za-z0-9_]{4,32}$/.test(uname)) {
      await send(chatId, "⚠️ Send a valid bot username, e.g. <code>@MyCoolBot</code>.");
      return;
    }
    await askBotRefLink(supabase, chatId, {
      category: "bots",
      title: `@${uname}`,
      link: `https://t.me/${uname}`,
      webapp: waMode,
    });
    return;
  }

  if (user?.pending_action?.startsWith("botref:") && !isMenu && !text.startsWith("/")) {
    const info = JSON.parse(user.pending_action.slice(7));
    const ref = text.trim();
    if (!/^https?:\/\/t\.me\/[A-Za-z0-9_]+(\?start=\S+)?$/i.test(ref)) {
      await send(chatId, "⚠️ Send a valid referral link, e.g. <code>https://t.me/gram_piarbot?start=123456789</code>.");
      return;
    }
    info.ref_link = ref;
    await showBotTaskType(supabase, chatId, info);
    return;
  }

  if (user?.pending_action?.startsWith("botcond:") && !isMenu && !text.startsWith("/")) {
    const info = JSON.parse(user.pending_action.slice(8));
    const cond = text.trim();
    if (cond.length > 400) {
      await send(chatId, "⚠️ Conditions cannot be longer than 400 characters. Please send a shorter text.");
      return;
    }
    info.conditions = cond;
    await showBotAudience(supabase, chatId, info);
    return;
  }



  if (user?.pending_action === "reactlink" && !isMenu && !text.startsWith("/")) {
    const link = text.trim();
    if (!/^https?:\/\/t\.me\/(c\/)?[A-Za-z0-9_]+\/\d+/.test(link)) {
      await send(
        chatId,
        "⚠️ Send a valid post link, e.g. <code>https://t.me/mychannel/123</code>.",
      );
      return;
    }
    await askPrice(supabase, chatId, {
      category: "reactions",
      title: "Post reactions",
      link,
      base_min_price: cfg("min_reactions"),
      min_price: cfg("min_reactions"),
    });
    return;
  }

  if (user?.pending_action?.startsWith("price:") && !isMenu && !text.startsWith("/")) {
    const info = JSON.parse(user.pending_action.slice(6));
    const min = Number(info.min_price ?? 1);
    const price = Number(text.replace(/[,\s]/g, ""));
    if (!price || price < min) {
      await send(chatId, `⚠️ Minimum ${min.toLocaleString("en-US")} ${COIN}. Please send a valid price.`);
      return;
    }
    info.reward = price;
    await askCount(supabase, chatId, info, Number(user.balance));
    return;
  }

  if (user?.pending_action?.startsWith("bud:") && !isMenu && !text.startsWith("/")) {
    const info = JSON.parse(user.pending_action.slice(4));
    const count = Number(text.replace(/[,\s]/g, ""));
    const reward = Number(info.reward);
    if (!count || count < 1 || !Number.isInteger(count)) {
      await send(chatId, "⚠️ Send the number of completions (digits only), e.g. <code>10</code>.");
      return;
    }
    await createCampaign(supabase, chatId, info, count, Number(user.balance));
    return;
  }




  if (user?.pending_action?.startsWith("amt:") && !isMenu && !text.startsWith("/")) {
    const info = JSON.parse(user.pending_action.slice(4)) as {
      category: string;
      title: string;
      link: string;
    };
    const parts = text.split("|").map((p) => p.trim());
    const reward = Number(parts[0]);
    const budget = Number(parts[1]);
    if (parts.length !== 2 || !reward || !budget || reward < 1 || budget < reward) {
      await send(chatId, "⚠️ Send it like this: <code>Reward | Budget</code>\nExample: <code>5 | 100</code>");
      return;
    }
    const minReward = info.category === "reactions" ? cfg("min_reactions") : 1;
    if (reward < minReward) {
      await send(chatId, `⚠️ Minimum reward for this task type is <b>${minReward} ${COIN}</b>.`);
      return;
    }

    if (user.balance < budget) {
      await send(chatId, `❌ Insufficient balance. You have <b>${user.balance} ${COIN}</b>.`);
      return;
    }
    await supabase.from("cg_ads").insert({
      owner_tg: chatId,
      title: info.title,
      link: info.link,
      reward,
      budget_left: budget,
      category: info.category,
    });
    await supabase
      .from("cg_users")
      .update({ balance: user.balance - budget, pending_action: null })
      .eq("tg_id", chatId);
    await supabase
      .from("cg_transactions")
      .insert({ tg_id: chatId, amount: -budget, reason: `Promotion: ${info.title}` });
    await send(
      chatId,
      `🚀 <b>Campaign is live!</b>\n\n${info.title}\nReward: ${reward} ${COIN} • Budget: ${budget} ${COIN}`,
      { reply_markup: MAIN_KEYBOARD },
    );
    return;
  }

  if (user?.pending_action?.startsWith("promote") && !isMenu && !text.startsWith("/")) {
    const parts = text.split("|").map((p) => p.trim());
    const [title, link, rewardRaw, budgetRaw] = parts;
    const reward = Number(rewardRaw);
    const budget = Number(budgetRaw);
    if (parts.length !== 4 || !link?.startsWith("http") || !reward || !budget || reward < 1 || budget < reward) {
      await send(chatId, "⚠️ Invalid format. Send it like this:\n<code>My Channel | https://t.me/mychannel | 5 | 100</code>");
      return;
    }
    if (user.balance < budget) {
      await send(chatId, `❌ Insufficient balance. You have <b>${user.balance} ${COIN}</b>, required <b>${budget} ${COIN}</b>.`);
      return;
    }
    await supabase.from("cg_ads").insert({
      owner_tg: chatId,
      title: title || "Promotion",
      link,
      reward,
      budget_left: budget,
      category: user.pending_action?.split(":")[1] || "channels",
    });
    await supabase
      .from("cg_users")
      .update({ balance: user.balance - budget, pending_action: null })
      .eq("tg_id", chatId);
    await supabase
      .from("cg_transactions")
      .insert({ tg_id: chatId, amount: -budget, reason: `Promotion: ${title}` });
    await send(chatId, `🚀 <b>Campaign is live!</b>\n\n${title}\nReward: ${reward} ${COIN} • Budget: ${budget} ${COIN}`);
    return;
  }

  if (text.startsWith("/start")) {
    const caption = `👋 <b>${from.first_name ?? "friend"}, welcome to COOL GRAM!</b>\n\nThe Telegram promotion platform${
      isNew ? `\n\n🎁 Welcome bonus: <b>+${cfg("signup_bonus")} ${COIN}</b>` : ""
    }`;
    const video = await tg("sendVideo", {
      chat_id: chatId,
      video: INTRO_VIDEO_URL,
      caption,
      parse_mode: "HTML",
      reply_markup: MAIN_KEYBOARD,
    });
    if (!video?.ok) await send(chatId, caption);
    return;
  }

  switch (text) {
    case "💰 Earnings":
      await showCategories(supabase, chatId);
      return;
    case "📢 Promote":
      await supabase.from("cg_users").update({ pending_action: null }).eq("tg_id", chatId);
      await showPromoteMenu(supabase, chatId);
      return;
    case "💸 Withdrawal": {
      if (!withdrawOpen()) {
        await send(chatId, WITHDRAW_CLOSED_MSG);
        return;
      }
      const min = cfg("min_withdraw");
      await supabase.from("cg_users").update({ pending_action: "withdraw" }).eq("tg_id", chatId);
      await send(
        chatId,
        `💸 <b>Withdrawal</b>\n\nBalance: <b>${user.balance} ${COIN}</b>\nMinimum withdrawal: <b>${min.toLocaleString("en-US")} ${COIN}</b>\n\nSend the amount you want to withdraw.`,
      );
      return;
    }
    case "⭐ Deposit":
      await showDepositMenu(supabase, chatId);
      return;
    case "👛 Wallet": {
      const { data: tx } = await supabase
        .from("cg_transactions")
        .select("amount, reason, created_at")
        .eq("tg_id", chatId)
        .order("created_at", { ascending: false })
        .limit(10);
      const lines = (tx ?? []).map(
        (t: any) => `${t.amount > 0 ? "🟢 +" : "🔴 "}${t.amount} ${COIN} — ${t.reason}`,
      );
      await send(
        chatId,
        `👛 <b>Wallet</b>\n\nID: <code>${chatId}</code>\nBalance: <b>${user.balance} ${COIN}</b>\nReferrals: <b>${user.referral_count}</b>\n\n🔗 Your invite link:\nhttps://t.me/${bot}?start=ref_${chatId}\nYou get <b>+${cfg("referral_bonus")} ${COIN}</b> per invite.\n\n🧾 <b>Last activity</b>\n${lines.length ? lines.join("\n") : "No activity yet."}`,
        {
          reply_markup: {
            inline_keyboard: [[{ text: "⭐ Deposit with Telegram Stars", callback_data: "dep_menu" }]],
          },
        },
      );
      return;
    }
    case "🆘 Cool Gram Support":
      await send(
        chatId,
        `🆘 <b>Cool Gram Support</b>\n\nTap the button below to open our support bot <b>@${SUPPORT_BOT}</b>.\n\nThere you can describe your problem by message, and also send photos or videos. Our team will reply as soon as possible.`,
        {
          reply_markup: {
            inline_keyboard: [[{ text: "💬 Open support chat", url: SUPPORT_LINK }]],
          },
        },
      );
      return;
    case "📊 Bots and Statistics": {
      const [users, s, myDone] = await Promise.all([
        supabase.from("cg_users").select("id", { count: "exact", head: true }),
        completionStats(supabase),
        supabase.from("cg_completions").select("id", { count: "exact", head: true }).eq("tg_id", chatId),
      ]);
      await send(
        chatId,
        `📊 <b>COOL GRAM statistics</b>\n\n` +
          `👥 Users: <b>${(users.count ?? 0).toLocaleString("en-US")}</b>\n` +
          `📢 Campaigns created: <b>${s.ads.toLocaleString("en-US")}</b>\n` +
          `🙋 Your completed tasks: <b>${(myDone.count ?? 0).toLocaleString("en-US")}</b>\n\n` +
          `<b>Completed by category</b>\n${statsText(s)}`,
      );
      return;
    }

    case "🔗 Useful Links":
      await send(
        chatId,
        `🔗 <b>Useful Links</b>\n\n• Bot: https://t.me/${bot}\n• Invite friends: https://t.me/${bot}?start=ref_${chatId}`,
      );
      return;
    case "ℹ️ Instruction":
      await send(
        chatId,
        `ℹ️ <b>How COOL GRAM works</b>\n\n1️⃣ <b>Earnings</b> — open a task, join the channel, tap "I did it" and get ${COIN}.\n2️⃣ <b>Promote</b> — spend your ${COIN} to promote your own channel.\n3️⃣ <b>Wallet</b> — balance, history and referral link.\n4️⃣ Invite friends and earn ${cfg("referral_bonus")} ${COIN} per invite.`,
      );
      return;
    default:
      await send(chatId, "🤔 I didn't understand that. Please choose an option from the menu below.");
  }
}

async function handleCallback(supabase: ReturnType<typeof db>, cb: any) {
  const msgId = cb.message?.message_id as number | undefined;
  const cid = cb.message?.chat?.id as number | undefined;
  const isText = typeof cb.message?.text === "string";
  editCtx = cid && msgId && isText ? { chatId: cid, messageId: msgId, used: false } : null;
  try {
    await handleCallbackInner(supabase, cb);
  } finally {
    editCtx = null;
  }
}

async function handleCallbackInner(supabase: ReturnType<typeof db>, cb: any) {
  const chatId = cb.message?.chat?.id as number;
  const data = String(cb.data ?? "");
  const fromId = Number(cb.from?.id ?? chatId);

  if (await isBlocked(supabase, fromId)) {
    await tg("answerCallbackQuery", {
      callback_query_id: cb.id,
      text: "🚫 You are blocked by the administrator.",
      show_alert: true,
    });
    return;
  }


  if (data === "chkjoin") {
    if (await isSponsorMember(fromId, true)) {
      await tg("answerCallbackQuery", { callback_query_id: cb.id, text: "✅ Verified!" });
      await send(chatId, "✅ Thanks for joining! You can use Cool Gram now.", {
        reply_markup: MAIN_KEYBOARD,
      });
    } else {
      await tg("answerCallbackQuery", {
        callback_query_id: cb.id,
        text: "❌ You have not joined the channel yet.",
        show_alert: true,
      });
    }
    return;
  }

  if (fromId !== OWNER_TG && !(await isSponsorMember(fromId))) {
    await tg("answerCallbackQuery", {
      callback_query_id: cb.id,
      text: "🔒 Join our channel first to continue.",
      show_alert: true,
    });
    const p = sponsorPrompt();
    await send(chatId, p.text, { reply_markup: p.reply_markup });
    return;
  }




  if (data === "dep_menu") {
    await tg("answerCallbackQuery", { callback_query_id: cb.id });
    await showDepositMenu(supabase, chatId);
    return;
  }

  if (data.startsWith("dep:")) {
    await tg("answerCallbackQuery", { callback_query_id: cb.id });
    await supabase.from("cg_users").update({ pending_action: null }).eq("tg_id", chatId);
    await sendStarsInvoice(chatId, Number(data.slice(4)));
    return;
  }

  if (data === "earn" || data === "back") {
    await tg("answerCallbackQuery", { callback_query_id: cb.id });
    if (data === "back") {
      await send(chatId, "🏠 Main menu", { reply_markup: MAIN_KEYBOARD });
    } else {
      await showCategories(supabase, chatId);
    }
    return;
  }

  if (data === "rules") {
    await tg("answerCallbackQuery", { callback_query_id: cb.id });
    await send(
      chatId,
      `📝 <b>Rules</b>\n\n1️⃣ Open the task, join the channel/group, then tap "I did it".\n2️⃣ Stay in every channel and group, and keep every bot you started, for at least 7 days. If you leave, block or remove them earlier, a penalty equal to the full reward of that task is deducted from your balance.\n3️⃣ Each task counts only once per user — every campaign is shown to you a single time.\n4️⃣ Cheating may reset your balance to zero.`,
      { reply_markup: { inline_keyboard: [[{ text: "🔙 Back", callback_data: "earn" }]] } },
    );
    return;
  }

  if (data.startsWith("promo:")) {
    const key = data.split(":")[1];
    const type = PROMO_TYPES.find((t) => t.key === key);
    await tg("answerCallbackQuery", { callback_query_id: cb.id });
    if (key === "views") {
      await askForwardPost(supabase, chatId);
      return;
    }
    if (key === "bots") {
      await showBotPromoInfo(supabase, chatId);
      return;
    }
    if (key === "reactions") {

      await askReactionLink(supabase, chatId);
      return;
    }
    if (key === "boost") {
      await showBoostTypeMenu(supabase, chatId);
      return;
    }
    if (key === "channels" || key === "groups") {
      await askChatPicker(supabase, chatId, key, key !== "groups");
      return;
    }
    await supabase.from("cg_users").update({ pending_action: `promote:${key}` }).eq("tg_id", chatId);
    await send(
      chatId,
      `${type?.label ?? "📢 Promotion"}\n\nSend it in one line:\n<code>Title | Link | Reward | Budget</code>\n\nExample:\n<code>My Channel | https://t.me/mychannel | 5 | 100</code>`,
      { reply_markup: { inline_keyboard: [[{ text: "🔙 Back", callback_data: "promo_menu" }]] } },
    );
    return;
  }

  if (data.startsWith("boostpick:")) {
    await tg("answerCallbackQuery", { callback_query_id: cb.id });
    const kind = data.split(":")[1] === "group" ? "group" : "channel";
    await askChatPicker(supabase, chatId, `boost_${kind}`, kind === "channel");
    return;
  }

  if (data.startsWith("boostdur:")) {
    await tg("answerCallbackQuery", { callback_query_id: cb.id });
    const info = await getPendingInfo(supabase, chatId, "boostdur");
    if (!info) {
      await showBoostTypeMenu(supabase, chatId);
      return;
    }
    const plans = boostPlans();
    const plan = plans.find((p) => p.key === data.split(":")[1]) ?? plans[0]!;
    info.days = plan.days;
    info.reward = plan.price;
    info.audience = "no restrictions";
    info.base_title = info.base_title ?? info.title;
    info.title = `${info.base_title} — ${plan.days} days boost`;
    const { data: u } = await supabase
      .from("cg_users")
      .select("balance")
      .eq("tg_id", chatId)
      .maybeSingle();
    await askCount(supabase, chatId, info, Number((u as any)?.balance ?? 0));
    return;
  }

  if (data === "bot_pick" || data === "bot_pick:webapp") {
    await tg("answerCallbackQuery", { callback_query_id: cb.id });
    await askBotLink(supabase, chatId, data === "bot_pick:webapp");
    return;
  }

  if (data === "botref_skip") {
    await tg("answerCallbackQuery", { callback_query_id: cb.id });
    const info = await getPendingInfo(supabase, chatId, "botref");
    if (!info) {
      await showPromoteMenu(supabase, chatId);
      return;
    }
    await showBotTaskType(supabase, chatId, info);
    return;
  }

  if (data.startsWith("bottype:")) {
    await tg("answerCallbackQuery", { callback_query_id: cb.id });
    const info = await getPendingInfo(supabase, chatId, "bottype");
    if (!info) {
      await showPromoteMenu(supabase, chatId);
      return;
    }
    const kind = data.split(":")[1];
    const hasApp = await botHasMiniApp(info.link);
    if (kind === "webapp") {
      if (hasApp === false) {
        await tg("sendMessage", {
          chat_id: chatId,
          text: "📱 <b>This bot has no Mini App.</b>\n\nOnly Mini App bots can be promoted here. Please pick another task type, or go back and select a Mini App bot.",
          parse_mode: "HTML",
        });
        await showBotTaskType(supabase, chatId, info);
        return;
      }
      info.webapp = true;
      info.task_type = "Bot with mini app";
      await showBotAudience(supabase, chatId, info);
      return;
    }
    if (hasApp === true) {
      await tg("sendMessage", {
        chat_id: chatId,
        text: "🤖 <b>This bot has a Mini App.</b>\n\nMini App bots must be promoted with the <b>📱 Bot with mini app</b> task type.",
        parse_mode: "HTML",
      });
      await showBotTaskType(supabase, chatId, info);
      return;
    }
    const isCond = kind !== "start";
    info.webapp = false;
    info.task_type = isCond ? "With additional conditions" : "Bot start only";

    if (isCond) {
      await askBotConditions(supabase, chatId, info);
    } else {
      await showBotAudience(supabase, chatId, info);
    }

    return;
  }

  if (data.startsWith("botaud:")) {
    await tg("answerCallbackQuery", { callback_query_id: cb.id });
    const info = await getPendingInfo(supabase, chatId, "botaud");
    if (!info) {
      await showPromoteMenu(supabase, chatId);
      return;
    }
    const isPremium = data.split(":")[1] === "premium";
    const cond = Boolean(info.conditions);
    info.audience = isPremium ? "Telegram Premium only" : "All users";
    info.base_min_price = cond
      ? isPremium
        ? cfg("bot_cond_prem")
        : cfg("bot_cond_all")
      : isPremium
        ? cfg("bot_prem")
        : cfg("bot_all");
    info.min_price = info.base_min_price;
    await supabase
      .from("cg_users")
      .update({ pending_action: `aud:${JSON.stringify(info)}` })
      .eq("tg_id", chatId);
    await showAudienceMenu(chatId, "no restrictions", cond ? cfg("bot_cond_surcharge") : cfg("aud_surcharge"), "back:botaud");

    return;
  }

  if (data.startsWith("wd:")) {
    const [, act, wid] = data.split(":");
    if (chatId !== OWNER_TG) {
      await tg("answerCallbackQuery", { callback_query_id: cb.id, text: "Not allowed", show_alert: true });
      return;
    }
    const { data: w } = await supabase
      .from("cg_withdrawals")
      .select("id,tg_id,username,amount,status")
      .eq("id", wid)
      .maybeSingle();
    if (!w || (w as any).status !== "pending") {
      await tg("answerCallbackQuery", { callback_query_id: cb.id, text: "Already handled", show_alert: true });
      return;
    }
    const amt = Number((w as any).amount);
    const uid = Number((w as any).tg_id);
    if (act === "ok") {
      await supabase
        .from("cg_withdrawals")
        .update({ status: "paid", resolved_at: new Date().toISOString() })
        .eq("id", wid);
      await send(uid, `✅ <b>Withdrawal completed</b>\n\nAmount: <b>${amt.toLocaleString("en-US")} ${COIN}</b>`);
    } else {
      const { data: u2 } = await supabase
        .from("cg_users")
        .select("balance")
        .eq("tg_id", uid)
        .maybeSingle();
      await supabase
        .from("cg_users")
        .update({ balance: Number((u2 as any)?.balance ?? 0) + amt })
        .eq("tg_id", uid);
      await supabase.from("cg_transactions").insert({
        tg_id: uid,
        amount: amt,
        reason: "Withdrawal refund",
      });
      await supabase
        .from("cg_withdrawals")
        .update({ status: "rejected", resolved_at: new Date().toISOString() })
        .eq("id", wid);
      await send(
        uid,
        `❌ <b>Withdrawal rejected</b>\n\n<b>${amt.toLocaleString("en-US")} ${COIN}</b> has been refunded to your balance.`,
      );
    }
    await tg("answerCallbackQuery", {
      callback_query_id: cb.id,
      text: act === "ok" ? "Marked as paid" : "Rejected and refunded",
    });
    await tg("editMessageReplyMarkup", {
      chat_id: chatId,
      message_id: cb.message?.message_id,
      reply_markup: { inline_keyboard: [[{ text: act === "ok" ? "✅ Paid" : "❌ Rejected", callback_data: "noop" }]] },
    });
    return;
  }

  if (data === "aud_all" || data === "aud_pick" || data === "aud_save" || data.startsWith("aud_set:")) {
    await tg("answerCallbackQuery", { callback_query_id: cb.id });
    const { data: u } = await supabase
      .from("cg_users")
      .select("pending_action")
      .eq("tg_id", chatId)
      .maybeSingle();
    const pending = (u as any)?.pending_action as string | null;
    if (!pending?.startsWith("aud:")) {
      await showPromoteMenu(supabase, chatId);
      return;
    }
    const info = JSON.parse(pending.slice(4));
    const cond = Boolean(info.conditions);
    const extra =
      info.category === "bots" && cond ? cfg("bot_cond_surcharge") : cfg("aud_surcharge");
    const langs: string[] = Array.isArray(info.langs) ? info.langs : [];
    if (data === "aud_pick") {
      await showLanguageMenu(chatId, extra, langs);
      return;
    }
    if (data.startsWith("aud_set:")) {
      const code = data.split(":")[1] ?? "en";
      const next = langs.includes(code) ? langs.filter((c) => c !== code) : [...langs, code];
      info.langs = next;
      await supabase
        .from("cg_users")
        .update({ pending_action: `aud:${JSON.stringify(info)}` })
        .eq("tg_id", chatId);
      await showLanguageMenu(chatId, extra, next);
      return;
    }
    if (data === "aud_save") {
      if (!langs.length) {
        await showLanguageMenu(chatId, extra, langs);
        return;
      }
      info.audience = langs.map((c) => LANGS.find((l) => l.code === c)?.label ?? c).join(", ");
      info.base_min_price = Number(info.base_min_price ?? info.min_price ?? 1);
      info.min_price = info.base_min_price + extra;
    } else {
      info.audience = info.audience === "Telegram Premium only" ? info.audience : "no restrictions";
      info.langs = [];
      info.base_min_price = Number(info.base_min_price ?? info.min_price ?? 1);
      info.min_price = info.base_min_price;
    }
    await askPrice(supabase, chatId, info);
    return;
  }


  if (data === "cnt_max") {
    await tg("answerCallbackQuery", { callback_query_id: cb.id });
    const info = await getPendingInfo(supabase, chatId, "bud");
    const { data: u } = await supabase
      .from("cg_users")
      .select("balance")
      .eq("tg_id", chatId)
      .maybeSingle();
    const balance = Number((u as any)?.balance ?? 0);
    if (!info) return;
    const max = Math.floor(balance / unitCost(Number(info.reward)));
    if (max < 1) {
      await send(chatId, "❌ Insufficient balance.");
      return;
    }
    await createCampaign(supabase, chatId, info, max, balance);
    return;
  }


  if (data === "aud_back") {
    await tg("answerCallbackQuery", { callback_query_id: cb.id });
    const info =
      (await getPendingInfo(supabase, chatId, "aud")) ??
      (await getPendingInfo(supabase, chatId, "price")) ??
      (await getPendingInfo(supabase, chatId, "bud"));
    const cond = Boolean(info?.conditions);
    const backTo =
      info?.category === "bots" ? "back:botaud" : `back:chatpick:${info?.category ?? "channels"}`;
    if (info) {
      delete info.audience;
      delete info.reward;
      await supabase
        .from("cg_users")
        .update({ pending_action: `aud:${JSON.stringify(info)}` })
        .eq("tg_id", chatId);
    }
    await showAudienceMenu(
      chatId,
      "no restrictions",
      info?.category === "bots" && cond ? cfg("bot_cond_surcharge") : cfg("aud_surcharge"),
      backTo,
    );

    return;
  }

  // Step-by-step back navigation (ek step peeche)
  if (data.startsWith("back:")) {
    await tg("answerCallbackQuery", { callback_query_id: cb.id });
    const step = data.slice(5);

    if (step === "boosttype") {
      await showBoostTypeMenu(supabase, chatId);
      return;
    }
    if (step === "boostdur") {
      const info =
        (await getPendingInfo(supabase, chatId, "bud")) ??
        (await getPendingInfo(supabase, chatId, "boostdur"));
      if (!info) {
        await showBoostTypeMenu(supabase, chatId);
        return;
      }
      info.title = info.base_title ?? info.title;
      await showBoostDuration(supabase, chatId, info);
      return;
    }
    if (step === "botpick") {
      await askBotLink(supabase, chatId);
      return;
    }
    if (step === "botinfo") {
      await showBotPromoInfo(supabase, chatId);
      return;
    }
    if (step === "fwd") {
      await askForwardPost(supabase, chatId);
      return;
    }
    if (step.startsWith("chatpick:")) {
      const category = step.split(":")[1] || "channels";
      await askChatPicker(supabase, chatId, category, category !== "groups");
      return;
    }

    // These steps need the data from the previous screen
    const current =
      (await getPendingInfo(supabase, chatId, "aud")) ??
      (await getPendingInfo(supabase, chatId, "botaud")) ??
      (await getPendingInfo(supabase, chatId, "botcond")) ??
      (await getPendingInfo(supabase, chatId, "bottype")) ??
      (await getPendingInfo(supabase, chatId, "botref"));
    if (!current) {
      await showPromoteMenu(supabase, chatId);
      return;
    }
    if (step === "botref") {
      await askBotRefLink(supabase, chatId, current);
      return;
    }
    if (step === "bottype") {
      await showBotTaskType(supabase, chatId, current);
      return;
    }
    if (step === "botcond") {
      await askBotConditions(supabase, chatId, current);
      return;
    }
    if (step === "botaud") {
      await showBotAudience(supabase, chatId, current);
      return;
    }
    await showPromoteMenu(supabase, chatId);
    return;
  }


  if (data === "promo_menu") {
    await tg("answerCallbackQuery", { callback_query_id: cb.id });
    await supabase.from("cg_users").update({ pending_action: null }).eq("tg_id", chatId);
    await showPromoteMenu(supabase, chatId);
    return;
  }

  if (data === "promo_auto") {
    await tg("answerCallbackQuery", { callback_query_id: cb.id });
    await send(
      chatId,
      "⚙️ <b>Auto-task settings</b>\n\nAuto-repeat tasks are coming soon. For now you can create campaigns manually.",
      { reply_markup: { inline_keyboard: [[{ text: "🔙 Back", callback_data: "promo_menu" }]] } },
    );
    return;
  }

  if (data === "promo_mine") {
    await tg("answerCallbackQuery", { callback_query_id: cb.id });
    await showMyTasks(supabase, chatId);
    return;
  }

  if (data.startsWith("cancel:")) {
    const adId = data.slice(7);
    const { data: ad } = await supabase
      .from("cg_ads")
      .select("id, owner_tg, title, budget_left, is_active")
      .eq("id", adId)
      .maybeSingle();
    const a = ad as any;
    if (!a || a.owner_tg !== chatId || !a.is_active) {
      await tg("answerCallbackQuery", { callback_query_id: cb.id, text: "This task is already cancelled." });
      await showMyTasks(supabase, chatId);
      return;
    }
    const refund = Number(a.budget_left ?? 0);
    await supabase.from("cg_ads").update({ is_active: false, budget_left: 0 }).eq("id", adId);
    if (refund > 0) {
      const { data: u } = await supabase
        .from("cg_users")
        .select("balance")
        .eq("tg_id", chatId)
        .maybeSingle();
      await supabase
        .from("cg_users")
        .update({ balance: Number((u as any)?.balance ?? 0) + refund })
        .eq("tg_id", chatId);
      await supabase
        .from("cg_transactions")
        .insert({ tg_id: chatId, amount: refund, reason: `Cancelled: ${a.title}` });
    }
    await supabase.from("cg_boost_claims").update({ status: "cancelled" }).eq("ad_id", adId);
    await tg("answerCallbackQuery", { callback_query_id: cb.id, text: "Task cancelled." });
    await send(
      chatId,
      `🛑 <b>Task cancelled</b>\n\n${a.title}\nRefunded: <b>${refund.toLocaleString("en-US")} ${COIN}</b> (commission is not refunded).`,
    );
    await showMyTasks(supabase, chatId);
    return;
  }

  if (data === "noop") {
    await tg("answerCallbackQuery", { callback_query_id: cb.id });
    return;
  }

  if (data.startsWith("report:")) {
    await tg("answerCallbackQuery", {
      callback_query_id: cb.id,
      text: "Report sent to moderators. Thank you!",
      show_alert: true,
    });
    return;
  }

  if (data.startsWith("page:")) {
    const [, catRaw, pg] = data.split(":");
    const [cat, sub] = (catRaw || "").split("|");
    await tg("answerCallbackQuery", { callback_query_id: cb.id });
    await showTask(supabase, chatId, cat || undefined, Number(pg) || 0, sub || undefined, Boolean(cb.from?.is_premium));
    return;
  }

  if (data.startsWith("botcat:")) {
    const sub = data.split(":")[1];
    await tg("answerCallbackQuery", { callback_query_id: cb.id });
    await showTask(supabase, chatId, "bots", 0, sub);
    return;
  }

  if (data.startsWith("cat:") || data.startsWith("next:")) {
    const category = data.split(":")[1] || undefined;
    await tg("answerCallbackQuery", { callback_query_id: cb.id });
    if (category === "bots") {
      await showBotSubcategories(supabase, chatId);
      return;
    }
    await showTask(supabase, chatId, category, 0, undefined, Boolean(cb.from?.is_premium));
    return;
  }


  if (data.startsWith("view:")) {
    const adId = data.slice(5);
    const { data: ad } = await supabase
      .from("cg_ads")
      .select("id, title, link, reward, budget_left, is_active, category, src_chat, src_msg")
      .eq("id", adId)
      .maybeSingle();
    const a = ad as any;
    if (!a || !a.is_active || a.budget_left < a.reward) {
      await tg("answerCallbackQuery", { callback_query_id: cb.id, text: "This task is no longer available." });
      return;
    }
    const { error } = await supabase.from("cg_completions").insert({ ad_id: adId, tg_id: chatId });
    if (error) {
      await tg("answerCallbackQuery", { callback_query_id: cb.id, text: "Already completed." });
      return;
    }
    await payReferralIfDue(supabase, chatId);
    const { data: u } = await supabase
      .from("cg_users")
      .select("balance")
      .eq("tg_id", chatId)
      .maybeSingle();
    await supabase
      .from("cg_users")
      .update({ balance: ((u as any)?.balance ?? 0) + a.reward })
      .eq("tg_id", chatId);
    await supabase.from("cg_ads").update({ budget_left: a.budget_left - a.reward }).eq("id", adId);
    await notifyIfCampaignFinished(supabase, adId);
    await supabase
      .from("cg_transactions")
      .insert({ tg_id: chatId, amount: a.reward, reason: `Task: ${a.title}` });
    await tg("answerCallbackQuery", { callback_query_id: cb.id, text: `+${a.reward} ${COIN} 🎉` });

    // Forward the promoted post into the bot chat
    let delivered = false;
    let fromChat: string | number | null = a.src_chat ?? null;
    let fromMsg: number | null = a.src_msg ?? null;
    if (!fromChat || !fromMsg) {
      const src = parsePostLink(a.link);
      if (src) {
        fromChat = src.chat;
        fromMsg = src.msg;
      }
    }
    if (fromChat && fromMsg) {
      let fwd = await tgRaw("forwardMessage", {
        chat_id: chatId,
        from_chat_id: fromChat,
        message_id: fromMsg,
      });
      if (!fwd?.ok) {
        fwd = await tgRaw("copyMessage", {
          chat_id: chatId,
          from_chat_id: fromChat,
          message_id: fromMsg,
        });
      }
      delivered = !!fwd?.ok;
    }
    if (!delivered) {
      await tgRaw("sendMessage", {
        chat_id: chatId,
        text: `👁 <b>Open the post</b>`,
        parse_mode: "HTML",
        reply_markup: { inline_keyboard: [[{ text: "👁 Open post", url: a.link }]] },
      });
    }

    // After 5 seconds: reward + Next Post / Report / Back
    await new Promise((r) => setTimeout(r, 5000));

    const newBalance = ((u as any)?.balance ?? 0) + a.reward;
    await tgRaw("sendMessage", {
      chat_id: chatId,
      text:
        `💲 You have earned ${a.reward.toLocaleString("en-US")} grams for viewing the post!\n` +
        `💰 Your balance: ${newBalance.toLocaleString("en-US")} grams`,
      reply_markup: {
        inline_keyboard: [
          [{ text: "▶️ Next Post", callback_data: "cat:views" }],
          [{ text: "❌ Report", callback_data: `report:views` }],
          [{ text: "🔙 Back", callback_data: "earn" }],
        ],
      },
    });
    return;
  }

  if (data.startsWith("proof:")) {
    const adId = data.slice(6);
    const { data: ad } = await supabase
      .from("cg_ads")
      .select("id, title, link, reward, budget_left, is_active, conditions")
      .eq("id", adId)
      .maybeSingle();
    if (!ad || !(ad as any).is_active || (ad as any).budget_left < Number((ad as any).reward ?? 0)) {
      await tg("answerCallbackQuery", { callback_query_id: cb.id, text: "This task is no longer available." });
      return;
    }
    const { data: existing } = await supabase
      .from("cg_completions")
      .select("id")
      .eq("ad_id", adId)
      .eq("tg_id", chatId)
      .maybeSingle();
    if (existing) {
      await tg("answerCallbackQuery", { callback_query_id: cb.id, text: "You have already completed this task." });
      return;
    }
    await supabase.from("cg_users").update({ pending_action: `proof:${adId}` }).eq("tg_id", chatId);
    await tg("answerCallbackQuery", { callback_query_id: cb.id });
    await send(
      chatId,
      `📸 <b>Send a screenshot as proof</b>\n\n` +
        `Task: <b>${(ad as any).title}</b>\n` +
        `Conditions: ${(ad as any).conditions ?? "Start the bot and open it"}\n\n` +
        `Complete the task, then send <b>one photo</b> here that shows it is done (the opened bot chat after you pressed Start).\n` +
        `The advertiser will review it and your reward will be credited after approval.`,
    );

    return;
  }

  if (data.startsWith("ppen:") || data.startsWith("pnop:")) {
    const applyPenalty = data.startsWith("ppen:");
    const [, adIdRaw, workerRaw] = data.split(":");
    const adId = adIdRaw ?? "";
    const worker = Number(workerRaw);
    if (chatId !== OWNER_TG) {
      await tg("answerCallbackQuery", { callback_query_id: cb.id, text: "Not allowed.", show_alert: true });
      return;
    }
    const { data: ad } = await supabase
      .from("cg_ads")
      .select("id, title, reward, owner_tg")
      .eq("id", adId)
      .maybeSingle();
    if (!ad) {
      await tg("answerCallbackQuery", { callback_query_id: cb.id, text: "Task not found." });
      return;
    }
    const advertiser = Number((ad as any).owner_tg);
    const penalty = Number((ad as any).reward);
    if (!applyPenalty) {
      await tg("answerCallbackQuery", { callback_query_id: cb.id, text: "No penalty applied." });
      await send(chatId, `✅ No penalty applied for <b>${(ad as any).title}</b>.`);
      return;
    }
    const { data: au } = await supabase
      .from("cg_users")
      .select("balance")
      .eq("tg_id", advertiser)
      .maybeSingle();
    const oldBal = Number((au as any)?.balance ?? 0);
    const newBal = Math.max(0, oldBal - penalty);
    await supabase.from("cg_users").update({ balance: newBal }).eq("tg_id", advertiser);
    await supabase.from("cg_transactions").insert({
      tg_id: advertiser,
      amount: -penalty,
      reason: `Penalty: unfair proof rejection for "${(ad as any).title}"`,
    });
    await tg("answerCallbackQuery", { callback_query_id: cb.id, text: "Penalty applied." });
    await send(
      chatId,
      `⚠️ Penalty of ${penalty.toLocaleString("en-US")} ${COIN} charged to <code>${advertiser}</code> for <b>${(ad as any).title}</b>.`,
    );
    await send(
      advertiser,
      `⚠️ <b>Penalty applied</b>\n\n` +
        `Admin reviewed your rejected proof for <b>${(ad as any).title}</b> and found the worker had completed the conditions.\n` +
        `-${penalty.toLocaleString("en-US")} ${COIN} deducted from your balance.\n` +
        `💰 Balance: ${newBal.toLocaleString("en-US")} ${COIN}\n\n` +
        `Reject a proof only when it is fake or incomplete. Repeated unfair rejections may get your campaigns blocked.`,
    );
    return;
  }


  if (data.startsWith("papv:") || data.startsWith("prej:")) {
    const approve = data.startsWith("papv:");
    const [, adIdRaw, workerRaw] = data.split(":");
    const adId = adIdRaw ?? "";
    const worker = Number(workerRaw);
    const { data: ad } = await supabase
      .from("cg_ads")
      .select("id, title, reward, budget_left, is_active, owner_tg")
      .eq("id", adId)
      .maybeSingle();
    if (!ad || !Number.isFinite(worker)) {
      await tg("answerCallbackQuery", { callback_query_id: cb.id, text: "Task not found." });
      return;
    }
    if (chatId !== Number((ad as any).owner_tg) && chatId !== OWNER_TG) {
      await tg("answerCallbackQuery", { callback_query_id: cb.id, text: "Not allowed.", show_alert: true });
      return;
    }
    const { data: already } = await supabase
      .from("cg_completions")
      .select("id")
      .eq("ad_id", adId)
      .eq("tg_id", worker)
      .maybeSingle();
    if (already) {
      await tg("answerCallbackQuery", { callback_query_id: cb.id, text: "Already reviewed." });
      return;
    }

    if (!approve) {
      await tg("answerCallbackQuery", { callback_query_id: cb.id, text: "Rejected." });
      await send(
        worker,
        `❌ <b>Your proof was rejected</b>\n\nTask: <b>${(ad as any).title}</b>\nComplete all the conditions and send a clear screenshot again.`,
        { reply_markup: { inline_keyboard: [[{ text: "📸 Send proof again", callback_data: `proof:${adId}` }]] } },
      );
      await send(chatId, `❌ Proof rejected for <b>${(ad as any).title}</b>.`);
      await supabase
        .from("cg_proofs")
        .update({ status: "rejected", resolved_at: new Date().toISOString() })
        .eq("ad_id", adId)
        .eq("tg_id", worker);


      // No automatic penalty. The rejection goes to the admin for review;
      // only the admin can decide to charge the advertiser.
      const advertiser = Number((ad as any).owner_tg);
      const penalty = Number((ad as any).reward);
      if (chatId === advertiser && advertiser !== OWNER_TG && penalty > 0) {
        await send(
          OWNER_TG,
          `⚠️ <b>Proof rejected by advertiser — review needed</b>\n\n` +
            `Task: <b>${(ad as any).title}</b>\n` +
            `Advertiser: <code>${advertiser}</code>\n` +
            `Worker: <code>${worker}</code>\n` +
            `Reward: <b>${penalty.toLocaleString("en-US")} ${COIN}</b>\n\n` +
            `Check the proof photo above. If the worker had completed the conditions, apply the penalty to the advertiser.`,
          {
            reply_markup: {
              inline_keyboard: [
                [
                  { text: "⚠️ Apply penalty", callback_data: `ppen:${adId}:${worker}` },
                  { text: "✅ Rejection was fair", callback_data: `pnop:${adId}:${worker}` },
                ],
              ],
            },
          },
        );
      }
      return;
    }


    const reward = Number((ad as any).reward);
    if (!(ad as any).is_active || Number((ad as any).budget_left) < reward) {
      await tg("answerCallbackQuery", { callback_query_id: cb.id, text: "Campaign has no budget left.", show_alert: true });
      return;
    }
    const { error: cErr } = await supabase.from("cg_completions").insert({ ad_id: adId, tg_id: worker });
    if (cErr) {
      await tg("answerCallbackQuery", { callback_query_id: cb.id, text: "Already reviewed." });
      return;
    }
    await payReferralIfDue(supabase, worker);
    const { data: wu } = await supabase
      .from("cg_users")
      .select("balance")
      .eq("tg_id", worker)
      .maybeSingle();
    const newBal = ((wu as any)?.balance ?? 0) + reward;
    await supabase.from("cg_users").update({ balance: newBal }).eq("tg_id", worker);
    await supabase
      .from("cg_ads")
      .update({ budget_left: Number((ad as any).budget_left) - reward })
      .eq("id", adId);
    await notifyIfCampaignFinished(supabase, adId);
    await supabase
      .from("cg_transactions")
      .insert({ tg_id: worker, amount: reward, reason: `Task: ${(ad as any).title}` });
    await tg("answerCallbackQuery", { callback_query_id: cb.id, text: "Approved ✅" });
    await send(
      worker,
      `✅ <b>Your proof was approved!</b>\n\nTask: <b>${(ad as any).title}</b>\n+${reward.toLocaleString("en-US")} ${COIN} credited.\n💰 Balance: ${newBal.toLocaleString("en-US")} ${COIN}`,
    );
    await supabase
      .from("cg_proofs")
      .update({ status: "approved", resolved_at: new Date().toISOString() })
      .eq("ad_id", adId)
      .eq("tg_id", worker);
    await send(chatId, `✅ Proof approved for <b>${(ad as any).title}</b> — ${reward.toLocaleString("en-US")} ${COIN} paid.`);

    return;
  }

  if (data.startsWith("done:")) {

    const adId = data.slice(5);
    const { data: ad } = await supabase
      .from("cg_ads")
      .select("id, title, reward, budget_left, is_active, category, link, src_chat, boost_days, owner_tg, conditions")
      .eq("id", adId)
      .maybeSingle();


    const catEarly = (ad as any)?.category as string;
    const needed =
      catEarly === "boost" ? boostDayReward(ad) : Number((ad as any)?.reward ?? 0);
    if (!ad || !(ad as any).is_active || (ad as any).budget_left < needed) {
      await tg("answerCallbackQuery", { callback_query_id: cb.id, text: "This task is no longer available." });
      return;
    }

    // Condition tasks and bot tasks never pay via Check — a proof photo must be sent first.
    if ((ad as any).conditions || catEarly === "bots") {
      await tg("answerCallbackQuery", {
        callback_query_id: cb.id,
        text: "📸 This task needs a proof photo. Send it first.",
        show_alert: true,
      });
      await send(
        chatId,
        `📸 <b>Photo proof required</b>\n\n` +
          `Task: <b>${(ad as any).title}</b>\n` +
          `Conditions: ${(ad as any).conditions ?? "Start the bot and open it"}\n\n` +
          `Start the bot, complete everything, take a screenshot, then send it here with the button below. Coins are credited only after the advertiser approves your photo.`,
        { reply_markup: { inline_keyboard: [[{ text: "📸 Send proof", callback_data: `proof:${adId}` }]] } },
      );
      return;
    }


    const cat = catEarly;
    if (cat === "boost") {
      if (!cb.from?.is_premium) {
        await tg("answerCallbackQuery", {
          callback_query_id: cb.id,
          text: "❌ Only Telegram Premium users can complete boost tasks.",
          show_alert: true,
        });
        return;
      }
      const ref = chatRefFromAd(ad);
      if (!ref) {
        await tg("answerCallbackQuery", {
          callback_query_id: cb.id,
          text: "Verification not possible for this task yet.",
          show_alert: true,
        });
        return;
      }
      const res: any = await tg("getUserChatBoosts", { chat_id: ref, user_id: chatId });
      const boosts = res?.result?.boosts ?? [];
      if (!res?.ok || !Array.isArray(boosts) || boosts.length === 0) {
        if (verifyBlocked(res)) {
          await pauseUnverifiableAd(supabase, ad, cb.id);
          await showTask(supabase, chatId, cat, 0, undefined, Boolean(cb.from?.is_premium));
          return;
        }
        await tg("answerCallbackQuery", {
          callback_query_id: cb.id,
          text: res?.ok
            ? "❌ You have not boosted this chat yet. Press Boost first, then Check."
            : "❌ Could not verify your boost. Boost the chat and try again.",
          show_alert: true,
        });
        return;
      }
      await handleBoostClaim(supabase, chatId, ad, cb.id);
      return;
    } else if (cat === "channels" || cat === "groups") {
      const ref = chatRefFromAd(ad);
      if (!ref) {
        await tg("answerCallbackQuery", {
          callback_query_id: cb.id,
          text: "Verification not possible for this task yet.",
          show_alert: true,
        });
        return;
      }
      const res: any = await tg("getChatMember", { chat_id: ref, user_id: chatId });
      const status = res?.result?.status;
      const joined = ["member", "administrator", "creator", "restricted"].includes(status);
      if (!joined) {
        if (verifyBlocked(res)) {
          await pauseUnverifiableAd(supabase, ad, cb.id);
          return;
        }


        await tg("answerCallbackQuery", {
          callback_query_id: cb.id,
          text: res?.ok
            ? "❌ You have not joined yet. Join first, then press Check."
            : "❌ Could not verify. Join the chat and try again.",
          show_alert: true,
        });
        return;
      }
    }



    const { error } = await supabase.from("cg_completions").insert({ ad_id: adId, tg_id: chatId });
    if (error) {
      await tg("answerCallbackQuery", { callback_query_id: cb.id, text: "You have already completed this task." });
      return;
    }
    await payReferralIfDue(supabase, chatId);

    const reward = (ad as any).reward as number;
    const { data: user } = await supabase
      .from("cg_users")
      .select("balance")
      .eq("tg_id", chatId)
      .maybeSingle();

    await supabase
      .from("cg_users")
      .update({ balance: ((user as any)?.balance ?? 0) + reward })
      .eq("tg_id", chatId);
    await supabase
      .from("cg_ads")
      .update({ budget_left: (ad as any).budget_left - reward })
      .eq("id", adId);
    await notifyIfCampaignFinished(supabase, adId);
    await supabase
      .from("cg_transactions")
      .insert({ tg_id: chatId, amount: reward, reason: `Task: ${(ad as any).title}` });

    await tg("answerCallbackQuery", { callback_query_id: cb.id, text: `+${reward} ${COIN} 🎉` });
    await send(chatId, `✅ Task complete! <b>+${reward} ${COIN}</b> credited.`);
    await showTask(supabase, chatId, (ad as any).category, 0, undefined, Boolean(cb.from?.is_premium));
  }
}

export const Route = createFileRoute("/api/public/telegram/webhook")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const apiKey = process.env["TELEGRAM_BOT_TOKEN"] ?? process.env["COOLGRAM_BOT_TOKEN"];
        if (!apiKey) return new Response("Not configured", { status: 500 });

        const expected = deriveSecret(apiKey);
        const actual = request.headers.get("X-Telegram-Bot-Api-Secret-Token") ?? "";
        if (!safeEqual(actual, expected)) return new Response("Unauthorized", { status: 401 });

        const update = await request.json();

        // Ignore update kinds we never act on (chat_member floods from big channels, etc.)
        const handled =
          update.pre_checkout_query ||
          update.callback_query ||
          update.my_chat_member ||
          update.message ||
          update.edited_message;
        if (!handled) return Response.json({ ok: true, ignored: true });

        const supabase = db();

        const settingsPromise = loadSettings(supabase);

        if (typeof update.update_id === "number") {
          const { error } = await supabase
            .from("cg_telegram_updates")
            .insert({ update_id: update.update_id });
          if (error) return Response.json({ ok: true, duplicate: true });
        }


        try {
          await settingsPromise;

          if (update.pre_checkout_query) {
            await tgRaw("answerPreCheckoutQuery", {
              pre_checkout_query_id: update.pre_checkout_query.id,
              ok: true,
            });
          } else if (update.message?.successful_payment) {
            await handleSuccessfulPayment(
              supabase,
              update.message.chat.id,
              update.message.from ?? {},
              update.message.successful_payment,
            );
          } else if (update.callback_query) {
            await handleCallback(supabase, update.callback_query);
          } else if (update.my_chat_member) {
            await handleBotMembershipUpdate(supabase, update.my_chat_member);
          } else {
            const message = update.message ?? update.edited_message;
            const chatId = message?.chat?.id;
            const text = message?.text;
            const shared = message?.chat_shared;
            const usersShared = message?.users_shared;
            const forwarded = message?.forward_origin ?? message?.forward_from_chat;
            const photo = message?.photo;
            let pending: string | null = null;
            if (chatId && (forwarded || photo || isOwner(Number(chatId)))) {
              const { data: u } = await supabase
                .from("cg_users")
                .select("pending_action")
                .eq("tg_id", chatId)
                .maybeSingle();
              pending = ((u as any)?.pending_action as string | null) ?? null;
            }
            if (
              chatId &&
              (pending === "bcast" || pending === "bcastall") &&
              isOwner(Number(chatId)) &&
              !String(text ?? "").startsWith("/")
            ) {
              await runBroadcast(supabase, Number(chatId), {
                copyFrom: { chat_id: Number(chatId), message_id: Number(message.message_id) },
                target: pending === "bcastall" ? "users" : "chats",
              });

            } else if (chatId && usersShared) await handleUsersShared(supabase, chatId, usersShared);
            else if (chatId && shared) await handleChatShared(supabase, chatId, shared);
            else if (chatId && photo && pending?.startsWith("proof:"))
              await handleProofPhoto(supabase, chatId, message, pending.slice(6));
            else if (chatId && forwarded && pending === "fwd:views")
              await handleForwardedPost(supabase, chatId, message);
            else if (chatId && text) await handleText(supabase, chatId, message.from ?? {}, text.trim());
          }
        } catch (err) {
          console.error("Cool Gram webhook error", err);
        }

        return Response.json({ ok: true });
      },
    },
  },
});
