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

async function tg(method: string, payload: unknown) {
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


const MAIN_KEYBOARD = {
  keyboard: [
    [{ text: "💰 Earnings" }, { text: "📢 Promote" }],
    [{ text: "🧾 Checks" }, { text: "👤 My Cabinet" }],
    [{ text: "✅ Subscription Check" }, { text: "📊 Bots and Statistics" }],
    [{ text: "🔗 Useful Links" }, { text: "ℹ️ Instruction" }],
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
    .select("category")
    .eq("is_active", true);
  const counts: Record<string, number> = {};
  for (const a of (ads ?? []) as any[]) {
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

async function showTask(supabase: ReturnType<typeof db>, chatId: number, category?: string) {
  const { data: done } = await supabase.from("cg_completions").select("ad_id").eq("tg_id", chatId);
  const doneIds = (done ?? []).map((d: any) => d.ad_id);

  let query = supabase
    .from("cg_ads")
    .select("id, title, link, reward, budget_left")
    .eq("is_active", true)
    .neq("owner_tg", chatId)
    .order("created_at", { ascending: true })
    .limit(1);
  if (category) query = query.eq("category", category);
  if (doneIds.length) query = query.not("id", "in", `(${doneIds.join(",")})`);

  const { data: ads } = await query;
  const ad = ads?.[0] as any;

  if (!ad || ad.budget_left < ad.reward) {
    await send(
      chatId,
      "😴 <b>Is category mein abhi koi task nahi hai.</b>\n\nThodi der baad wapas aayein — naye tasks har roz add hote hain.",
      { reply_markup: { inline_keyboard: [[{ text: "🔙 Back", callback_data: "earn" }]] } },
    );
    return;
  }

  await send(chatId, `💰 <b>${ad.title}</b>\n\nReward: <b>+${ad.reward} ${COIN}</b>\n\nChannel join karein, phir "I did it" dabayein.`, {
    reply_markup: {
      inline_keyboard: [
        [{ text: "🔗 Open channel", url: ad.link }],
        [{ text: "✅ I did it", callback_data: `done:${ad.id}` }],
        [{ text: "⏭ Skip", callback_data: `next:${category ?? ""}` }],
        [{ text: "🔙 Back", callback_data: "earn" }],
      ],
    },
  });
}

async function handleText(supabase: ReturnType<typeof db>, chatId: number, from: any, text: string) {
  const startPayload = text.startsWith("/start") ? text.split(" ")[1] : undefined;
  const { user, isNew } = await getUser(supabase, from, startPayload);
  const bot = await botUsername();

  if (user?.pending_action === "promote" && !text.startsWith("/")) {
    const parts = text.split("|").map((p) => p.trim());
    const [title, link, rewardRaw, budgetRaw] = parts;
    const reward = Number(rewardRaw);
    const budget = Number(budgetRaw);
    if (parts.length !== 4 || !link?.startsWith("http") || !reward || !budget || reward < 1 || budget < reward) {
      await send(chatId, "⚠️ Format galat hai. Aise bhejein:\n<code>My Channel | https://t.me/mychannel | 5 | 100</code>");
      return;
    }
    if (user.balance < budget) {
      await send(chatId, `❌ Balance kam hai. Aapke paas <b>${user.balance} ${COIN}</b> hain, chahiye <b>${budget} ${COIN}</b>.`);
      return;
    }
    await supabase.from("cg_ads").insert({
      owner_tg: chatId,
      title: title || "Promotion",
      link,
      reward,
      budget_left: budget,
    });
    await supabase
      .from("cg_users")
      .update({ balance: user.balance - budget, pending_action: null })
      .eq("tg_id", chatId);
    await supabase
      .from("cg_transactions")
      .insert({ tg_id: chatId, amount: -budget, reason: `Promotion: ${title}` });
    await send(chatId, `🚀 <b>Campaign live hai!</b>\n\n${title}\nReward: ${reward} ${COIN} • Budget: ${budget} ${COIN}`);
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
      await showTask(supabase, chatId);
      return;
    case "📢 Promote":
      await supabase.from("cg_users").update({ pending_action: "promote" }).eq("tg_id", chatId);
      await send(
        chatId,
        `📢 <b>Promote your channel</b>\n\nEk line mein bhejein:\n<code>Title | Link | Reward | Budget</code>\n\nExample:\n<code>My Channel | https://t.me/mychannel | 5 | 100</code>\n\nBalance: <b>${user.balance} ${COIN}</b>`,
      );
      return;
    case "🧾 Checks": {
      const { data: tx } = await supabase
        .from("cg_transactions")
        .select("amount, reason, created_at")
        .eq("tg_id", chatId)
        .order("created_at", { ascending: false })
        .limit(10);
      const lines = (tx ?? []).map(
        (t: any) => `${t.amount > 0 ? "🟢 +" : "🔴 "}${t.amount} ${COIN} — ${t.reason}`,
      );
      await send(chatId, `🧾 <b>Last activity</b>\n\n${lines.length ? lines.join("\n") : "Abhi koi activity nahi."}`);
      return;
    }
    case "👤 My Cabinet":
      await send(
        chatId,
        `👤 <b>My Cabinet</b>\n\nID: <code>${chatId}</code>\nBalance: <b>${user.balance} ${COIN}</b>\nReferrals: <b>${user.referral_count}</b>\n\n🔗 Your invite link:\nhttps://t.me/${bot}?start=ref_${chatId}\n\nHar invite pe <b>+${REFERRAL_BONUS} ${COIN}</b>.`,
      );
      return;
    case "✅ Subscription Check": {
      const { count } = await supabase
        .from("cg_completions")
        .select("id", { count: "exact", head: true })
        .eq("tg_id", chatId);
      await send(
        chatId,
        `✅ <b>Subscription Check</b>\n\nAapne ab tak <b>${count ?? 0}</b> tasks complete kiye hain.\n\nNote: jo channels aapne join kiye hain unhe leave na karein, warna aage tasks block ho sakte hain.`,
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
        `ℹ️ <b>How COOL GRAM works</b>\n\n1️⃣ <b>Earnings</b> — task kholein, channel join karein, "I did it" dabayein aur ${COIN} paayein.\n2️⃣ <b>Promote</b> — apne ${COIN} kharch karke apna channel promote karein.\n3️⃣ <b>My Cabinet</b> — balance aur referral link.\n4️⃣ Dost invite karein aur har invite pe ${REFERRAL_BONUS} ${COIN} kamayein.`,
      );
      return;
    default:
      await send(chatId, "🤔 Samajh nahi aaya. Neeche menu se koi option chunein.");
  }
}

async function handleCallback(supabase: ReturnType<typeof db>, cb: any) {
  const chatId = cb.message?.chat?.id as number;
  const data = String(cb.data ?? "");

  if (data === "next") {
    await tg("answerCallbackQuery", { callback_query_id: cb.id });
    await showTask(supabase, chatId);
    return;
  }

  if (data.startsWith("done:")) {
    const adId = data.slice(5);
    const { data: ad } = await supabase
      .from("cg_ads")
      .select("id, title, reward, budget_left, is_active")
      .eq("id", adId)
      .maybeSingle();

    if (!ad || !(ad as any).is_active || (ad as any).budget_left < (ad as any).reward) {
      await tg("answerCallbackQuery", { callback_query_id: cb.id, text: "Ye task ab available nahi hai." });
      return;
    }

    const { error } = await supabase.from("cg_completions").insert({ ad_id: adId, tg_id: chatId });
    if (error) {
      await tg("answerCallbackQuery", { callback_query_id: cb.id, text: "Ye task pehle hi complete ho chuka hai." });
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
    await supabase
      .from("cg_transactions")
      .insert({ tg_id: chatId, amount: reward, reason: `Task: ${(ad as any).title}` });

    await tg("answerCallbackQuery", { callback_query_id: cb.id, text: `+${reward} ${COIN} 🎉` });
    await send(chatId, `✅ Task complete! <b>+${reward} ${COIN}</b> credited.`);
    await showTask(supabase, chatId);
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

        if (typeof update.update_id === "number") {
          const { error } = await supabase
            .from("cg_telegram_updates")
            .insert({ update_id: update.update_id });
          if (error) return Response.json({ ok: true, duplicate: true });
        }

        try {
          if (update.callback_query) {
            await handleCallback(supabase, update.callback_query);
          } else {
            const message = update.message ?? update.edited_message;
            const chatId = message?.chat?.id;
            const text = message?.text;
            if (chatId && text) await handleText(supabase, chatId, message.from ?? {}, text.trim());
          }
        } catch (err) {
          console.error("Cool Gram webhook error", err);
        }

        return Response.json({ ok: true });
      },
    },
  },
});
