import { createFileRoute } from "@tanstack/react-router";
import { createClient } from "@supabase/supabase-js";
import { createHash, timingSafeEqual } from "crypto";

const COIN = "CG";
const INTRO_VIDEO_URL =
  "https://project--df5c0224-0a9b-491a-a8d1-60dc4387ca37-dev.lovable.app/__l5e/assets-v1/44cc983b-29b2-4358-a478-976fbd96ea23/coolgram-intro-v2.mp4";
const SIGNUP_BONUS = 25;
const REFERRAL_BONUS = 50;

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

const SETTINGS: Record<string, { def: number; label: string }> = {
  min_channel: { def: 750, label: "Channel subscriber min price" },
  min_group: { def: 600, label: "Group join min price" },
  min_views: { def: 25, label: "Post view min price" },
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
};

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
  // Campaign stays active — we never delete or pause it. We just tell both sides.
  await tg("answerCallbackQuery", {
    callback_query_id: cbId,
    text:
      "\u26a0\ufe0f Cool Gram can't verify this chat right now. Make sure you joined, then press Check again.",
    show_alert: true,
  });
  if (ad?.owner_tg) {
    await send(
      Number(ad.owner_tg),
      `\u2139\ufe0f Cool Gram could not verify a completion for <b>${ad.title}</b>.\n\n` +
        `Please make sure <b>@CoolGram_bot</b> is an admin in that chat. ` +
        `Your campaign is still live.`,
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



const MAIN_KEYBOARD = {
  keyboard: [
    [{ text: "💰 Earnings" }, { text: "📢 Promote" }],
    [{ text: "💸 Withdrawal" }, { text: "⭐ Deposit" }],
    [{ text: "👛 Wallet" }, { text: "📊 Bots and Statistics" }],
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
      balance: SIGNUP_BONUS,
      referred_by: referrer,
    })
    .select("tg_id, balance, referral_count, pending_action")
    .single();

  await supabase.from("cg_transactions").insert({
    tg_id: from.id,
    amount: SIGNUP_BONUS,
    reason: "Welcome bonus",
  });

  if (referrer) {
    const { data: refUser } = await supabase
      .from("cg_users")
      .select("balance, referral_count")
      .eq("tg_id", referrer)
      .maybeSingle();
    if (refUser) {
      await supabase
        .from("cg_users")
        .update({
          balance: (refUser as any).balance + REFERRAL_BONUS,
          referral_count: (refUser as any).referral_count + 1,
        })
        .eq("tg_id", referrer);
      await supabase
        .from("cg_transactions")
        .insert({ tg_id: referrer, amount: REFERRAL_BONUS, reason: "Referral bonus" });
      await send(referrer, `🎉 New referral joined! +${REFERRAL_BONUS} ${COIN} added to your balance.`);
    }
  }

  return { user: created as unknown as CgUser, isNew: true };
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
  const { data: ads } = await supabase
    .from("cg_ads")
    .select("id, category, reward, budget_left")
    .eq("is_active", true)
    .neq("owner_tg", chatId);
  const { data: done } = await supabase.from("cg_completions").select("ad_id").eq("tg_id", chatId);
  const doneSet = new Set(((done ?? []) as any[]).map((d) => String(d.ad_id)));
  const counts: Record<string, number> = {};
  for (const a of (ads ?? []) as any[]) {
    if (doneSet.has(String(a.id)) || a.budget_left < a.reward) continue;
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
    label: "📱 Bots with Web App",
    title: "📱 Web App bots",
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
    .select("id, subtype, reward, budget_left")
    .eq("is_active", true)
    .eq("category", "bots")
    .neq("owner_tg", chatId);
  const { data: doneB } = await supabase.from("cg_completions").select("ad_id").eq("tg_id", chatId);
  const doneSetB = new Set(((doneB ?? []) as any[]).map((d) => String(d.ad_id)));
  const counts: Record<string, number> = {};
  for (const a of (ads ?? []) as any[]) {
    if (doneSetB.has(String(a.id)) || a.budget_left < a.reward) continue;
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
  const { data: done } = await supabase.from("cg_completions").select("ad_id").eq("tg_id", chatId);
  const doneIds = (done ?? []).map((d: any) => d.ad_id);
  const backCb = category === "bots" ? "cat:bots" : "earn";


  let query = supabase
    .from("cg_ads")
    .select("id, title, link, reward, budget_left, boost_days")
    .eq("is_active", true)
    .neq("owner_tg", chatId)
    .order("reward", { ascending: false });
  if (category) query = query.eq("category", category);
  if (subtype) {
    if (subtype === "plain") query = query.or("subtype.is.null,subtype.eq.plain");
    else query = query.eq("subtype", subtype);
  }
  const { data: allAds } = await query;
  const doneSet = new Set(doneIds.map(String));
  const ads = ((allAds ?? []) as any[]).filter(
    (a) => a.budget_left >= a.reward && !doneSet.has(String(a.id)),
  );

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

  const rows: any[] = slice.map((ad) =>
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
          { text: "🔄 Check", callback_data: `done:${ad.id}` },
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
      `Tap <b>🏠 I'm an admin</b> — Telegram will add <b>@${bot}</b> as admin right there. ` +
      `Or use the button below to make the bot admin directly.`,
    parse_mode: "HTML",
    reply_markup: {
      keyboard: [
        [
          {
            text: "🏠 I'm an admin",
            request_chat: {
              request_id: 1,
              chat_is_channel: isChannel,
              request_title: true,
              request_username: true,
              user_administrator_rights: { is_anonymous: false, can_invite_users: true },
              bot_administrator_rights: {
                is_anonymous: false,
                can_manage_chat: true,
                can_invite_users: true,
                ...(isChannel ? { can_post_messages: true } : {}),
              },
            },
          },
        ],
        [
          {
            text: "🌐 I'm not an admin",
            request_chat: {
              request_id: 2,
              chat_is_channel: isChannel,
              request_title: true,
              request_username: true,
            },
          },
        ],
        [{ text: "🔙 Back" }],
      ],
      resize_keyboard: true,
      one_time_keyboard: true,
    },
  });
  await tg("sendMessage", {
    chat_id: chatId,
    text: `🛡 <b>Make @${bot} admin directly</b>\nPick your ${isChannel ? "channel" : "group"} in the list Telegram shows, then confirm.`,
    parse_mode: "HTML",
    reply_markup: {
      inline_keyboard: [
        [
          {
            text: "🛡 Add bot as admin",
            url: `https://t.me/${bot}?${isChannel ? "startchannel" : "startgroup"}&admin=invite_users+manage_chat${isChannel ? "+post_messages" : ""}`,
          },
        ],
      ],
    },
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

async function showBotPromoInfo(supabase: ReturnType<typeof db>, chatId: number) {
  await supabase.from("cg_users").update({ pending_action: null }).eq("tg_id", chatId);
  await tg("sendMessage", {
    chat_id: chatId,
    text:
      "🤖 <b>Choose the bot you want to promote</b>\n\n" +
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
          { text: "🤖 Choose bot", callback_data: "bot_pick" },
          { text: "⬅️ Back", callback_data: "promo_menu" },
        ],
      ],
    },
  });
}

async function askBotLink(supabase: ReturnType<typeof db>, chatId: number) {
  await supabase.from("cg_users").update({ pending_action: "botlink" }).eq("tg_id", chatId);
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
  await askBotRefLink(supabase, chatId, { category: "bots", title, link });
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
  await setPending(supabase, chatId, "bottype", info);
  await tg("sendMessage", {
    chat_id: chatId,
    text:
      "🤖 <b>Choose the task type:</b>\n\n" +
      "▶️ <b>Bot start only</b> — the worker opens the bot and presses Start (+ completes a captcha or selects a language, if prompted). No other actions.\n\n" +
      "📝 <b>With additional conditions</b> — you can request additional actions. For example, subscribing to sponsors or completing a simple action.",
    parse_mode: "HTML",
    reply_markup: {
      inline_keyboard: [
        [
          { text: "▶️ Bot start only", callback_data: "bottype:start" },
          { text: "📝 With additional conditions", callback_data: "bottype:cond" },
        ],
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
              url: `https://t.me/${botUsername}?startchannel=true&admin=post_messages+edit_messages+invite_users`,
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
    const st = chk?.result?.status;
    // Only block when Telegram clearly says the bot is not inside the chat.
    const clearlyOutside = chk?.ok === true && ["left", "kicked"].includes(st);
    if (clearlyOutside) {
      await send(
        chatId,
        `\u274c <b>Cool Gram is not added to ${shared.title ?? "that chat"}.</b>\n\n` +
          `1. Open that chat \u2192 Administrators \u2192 Add admin\n` +
          `2. Add <b>@CoolGram_bot</b>\n` +
          `3. Come back and select the chat again.`,
      );
      const isCh = category === "channels" || category.startsWith("boost_ch");
      if (category.startsWith("boost_")) await showBoostTypeMenu(supabase, chatId);
      else await askChatPicker(supabase, chatId, category, isCh);
      return;
    }
  }


  const title = shared.title ?? "My channel";
  const link = shared.username
    ? `https://t.me/${shared.username}`
    : `https://t.me/c/${String(shared.chat_id).replace("-100", "")}`;

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
      `<code>/setprice &lt;key&gt; &lt;value&gt;</code> — change any setting\n` +
      `<code>/resetprice &lt;key&gt;</code> — back to default\n` +
      `<code>/addbalance &lt;tg_id&gt; &lt;amount&gt;</code> — add ${COIN} to a user\n` +
      `<code>/takebalance &lt;tg_id&gt; &lt;amount&gt;</code> — remove ${COIN}\n` +
      `<code>/userinfo &lt;tg_id&gt;</code> — user details\n` +
      `<code>/deposits</code> — last Stars deposits`,
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

  if (cmd === "/setprice") {
    const key = args[0] ?? "";
    const value = Number(args[1]);
    if (!SETTINGS[key] || !Number.isFinite(value) || value < 0) {
      await send(
        chatId,
        `⚠️ Use: <code>/setprice &lt;key&gt; &lt;value&gt;</code>\nKeys: ${Object.keys(SETTINGS)
          .map((k) => `<code>${k}</code>`)
          .join(", ")}`,
      );
      return true;
    }
    await supabase.from("cg_settings").upsert({ key, value, updated_at: new Date().toISOString() });
    settingsMap[key] = value;
    await send(
      chatId,
      `✅ <b>${SETTINGS[key]!.label}</b> updated to <b>${value.toLocaleString("en-US")}</b>.`,
    );
    return true;
  }

  if (cmd === "/resetprice") {
    const key = args[0] ?? "";
    if (!SETTINGS[key]) {
      await send(chatId, "⚠️ Unknown key. Open /admin to see all keys.");
      return true;
    }
    await supabase.from("cg_settings").delete().eq("key", key);
    delete settingsMap[key];
    await send(chatId, `♻️ <b>${SETTINGS[key]!.label}</b> reset to default <b>${SETTINGS[key]!.def}</b>.`);
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

async function handleText(supabase: ReturnType<typeof db>, chatId: number, from: any, text: string) {
  const startPayload = text.startsWith("/start") ? text.split(" ")[1] : undefined;
  const { user, isNew } = await getUser(supabase, from, startPayload);
  const bot = await botUsername();

  if (text.startsWith("/") && (await handleAdminCommand(supabase, chatId, text))) return;

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
    if (text !== "🏠 Main menu" && prev === "botlink") {
      await showBotPromoInfo(supabase, chatId);
      return;
    }
    await showPromoteMenu(supabase, chatId);
    return;
  }

  if (user?.pending_action === "botlink" && !isMenu && !text.startsWith("/")) {
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
    await supabase
      .from("cg_users")
      .update({
        pending_action: `amt:${JSON.stringify({
          category: "reactions",
          title: "Post reactions",
          link,
        })}`,
      })
      .eq("tg_id", chatId);
    await send(
      chatId,
      `✅ Post selected:\n${link}\n\nNow send the reward and budget:\n<code>Reward | Budget</code>\nExample: <code>5 | 100</code>`,
      { reply_markup: MAIN_KEYBOARD },
    );
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
      isNew ? `\n\n🎁 Welcome bonus: <b>+${SIGNUP_BONUS} ${COIN}</b>` : ""
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
        `👛 <b>Wallet</b>\n\nID: <code>${chatId}</code>\nBalance: <b>${user.balance} ${COIN}</b>\nReferrals: <b>${user.referral_count}</b>\n\n🔗 Your invite link:\nhttps://t.me/${bot}?start=ref_${chatId}\nYou get <b>+${REFERRAL_BONUS} ${COIN}</b> per invite.\n\n🧾 <b>Last activity</b>\n${lines.length ? lines.join("\n") : "No activity yet."}`,
        {
          reply_markup: {
            inline_keyboard: [[{ text: "⭐ Deposit with Telegram Stars", callback_data: "dep_menu" }]],
          },
        },
      );
      return;
    }
    case "📊 Bots and Statistics": {
      const users = await supabase.from("cg_users").select("id", { count: "exact", head: true });
      const ads = await supabase
        .from("cg_ads")
        .select("id", { count: "exact", head: true })
        .eq("is_active", true);
      await send(
        chatId,
        `📊 <b>COOL GRAM statistics</b>\n\n👥 Users: <b>${users.count ?? 0}</b>\n📢 Active campaigns: <b>${ads.count ?? 0}</b>`,
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
        `ℹ️ <b>How COOL GRAM works</b>\n\n1️⃣ <b>Earnings</b> — open a task, join the channel, tap "I did it" and get ${COIN}.\n2️⃣ <b>Promote</b> — spend your ${COIN} to promote your own channel.\n3️⃣ <b>Wallet</b> — balance, history and referral link.\n4️⃣ Invite friends and earn ${REFERRAL_BONUS} ${COIN} per invite.`,
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
      `📝 <b>Rules</b>\n\n1️⃣ Open the task, join the channel/group, then tap "I did it".\n2️⃣ Do not leave right after joining.\n3️⃣ Each task counts only once.\n4️⃣ Cheating may reset your balance to zero.`,
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

  if (data === "bot_pick") {
    await tg("answerCallbackQuery", { callback_query_id: cb.id });
    await askBotLink(supabase, chatId);
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
    const isCond = data.split(":")[1] !== "start";
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

  if (data.startsWith("done:")) {

    const adId = data.slice(5);
    const { data: ad } = await supabase
      .from("cg_ads")
      .select("id, title, reward, budget_left, is_active, category, link, src_chat, boost_days, owner_tg")
      .eq("id", adId)
      .maybeSingle();


    const catEarly = (ad as any)?.category as string;
    const needed =
      catEarly === "boost" ? boostDayReward(ad) : Number((ad as any)?.reward ?? 0);
    if (!ad || !(ad as any).is_active || (ad as any).budget_left < needed) {
      await tg("answerCallbackQuery", { callback_query_id: cb.id, text: "This task is no longer available." });
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
          } else {
            const message = update.message ?? update.edited_message;
            const chatId = message?.chat?.id;
            const text = message?.text;
            const shared = message?.chat_shared;
            const usersShared = message?.users_shared;
            const forwarded = message?.forward_origin ?? message?.forward_from_chat;
            let pending: string | null = null;
            if (chatId && forwarded) {
              const { data: u } = await supabase
                .from("cg_users")
                .select("pending_action")
                .eq("tg_id", chatId)
                .maybeSingle();
              pending = ((u as any)?.pending_action as string | null) ?? null;
            }
            if (chatId && usersShared) await handleUsersShared(supabase, chatId, usersShared);
            else if (chatId && shared) await handleChatShared(supabase, chatId, shared);
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
