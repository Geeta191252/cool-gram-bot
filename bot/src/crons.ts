import { createClient } from "./mongo.js";

const COIN = "CG";
const BOOST_BATCH = 50;
const LEAVE_BATCH = 200;
const HOLD_DAYS = 7;

async function tg(method: string, payload: Record<string, unknown>) {
  const token = process.env["TELEGRAM_BOT_TOKEN"] ?? process.env["COOLGRAM_BOT_TOKEN"];
  if (!token) return null;
  const res = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  return res.json().catch(() => null);
}

export async function runBoostReminders() {
  const supabase = createClient();
  const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

  const { data: claims, error } = await supabase
    .from("cg_boost_claims")
    .select("id, ad_id, tg_id, days_claimed, total_days, last_claim_at, reminded_at")
    .eq("status", "active")
    .lt("last_claim_at", cutoff)
    .order("last_claim_at", { ascending: true })
    .limit(BOOST_BATCH);

  if (error) throw new Error(error.message);

  let sent = 0;
  for (const raw of (claims ?? []) as any[]) {
    if (raw.reminded_at && new Date(raw.reminded_at) > new Date(raw.last_claim_at)) continue;

    const { data: adRow } = await supabase
      .from("cg_ads")
      .select("id, title, reward, boost_days, is_active, budget_left, link")
      .eq("id", raw.ad_id)
      .maybeSingle();
    const ad = adRow as any;
    if (!ad || !ad.is_active) {
      await supabase.from("cg_boost_claims").update({ status: "cancelled" }).eq("id", raw.id);
      continue;
    }

    const days = Number(ad.boost_days) > 0 ? Number(ad.boost_days) : Number(raw.total_days) || 7;
    const perDay = Math.max(1, Math.floor(Number(ad.reward ?? 0) / days));

    await tg("sendMessage", {
      chat_id: raw.tg_id,
      parse_mode: "HTML",
      disable_web_page_preview: true,
      text:
        `⚡️ <b>Continue your boost</b>\n\n${ad.title}\n\n` +
        `Day ${Number(raw.days_claimed) + 1} of ${days} is ready. Keep the boost active and press <b>Check boost</b> to receive <b>+${perDay.toLocaleString("en-US")} ${COIN}</b>.`,
      reply_markup: {
        inline_keyboard: [
          [{ text: "🔄 Check boost", callback_data: `done:${ad.id}` }],
          [{ text: "⚡️ Open chat", url: String(ad.link ?? "").split("?")[0] + "?boost" }],
        ],
      },
    });

    await supabase
      .from("cg_boost_claims")
      .update({ reminded_at: new Date().toISOString() })
      .eq("id", raw.id);
    sent += 1;
  }

  return { sent };
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

export async function runLeaveCheck() {
  const supabase = createClient();
  const since = new Date(Date.now() - HOLD_DAYS * 24 * 60 * 60 * 1000).toISOString();

  const { data: rows, error } = await supabase
    .from("cg_completions")
    .select("id, ad_id, tg_id, created_at")
    .gte("created_at", since)
    .order("created_at", { ascending: true })
    .limit(LEAVE_BATCH);

  if (error) throw new Error(error.message);

  let penalized = 0;
  let checked = 0;

  for (const raw of (rows ?? []) as any[]) {
    const { data: adRow } = await supabase
      .from("cg_ads")
      .select("id, title, link, src_chat, category")
      .eq("id", raw.ad_id)
      .maybeSingle();
    const ad = adRow as any;
    if (!ad || !["channels", "groups"].includes(String(ad.category))) continue;

    const ref = chatRefFromAd(ad);
    if (!ref) continue;

    const res: any = await tg("getChatMember", { chat_id: ref, user_id: raw.tg_id });
    checked += 1;
    const status = res?.result?.status;
    const left = res?.ok === true && ["left", "kicked"].includes(status);
    if (!left) continue;

    const { data: u } = await supabase
      .from("cg_users")
      .select("balance")
      .eq("tg_id", raw.tg_id)
      .maybeSingle();
    const balance = Number((u as any)?.balance ?? 0);

    await supabase.from("cg_users").update({ balance: 0 }).eq("tg_id", raw.tg_id);
    await supabase.from("cg_completions").delete().eq("id", raw.id);

    if (balance > 0) {
      await supabase.from("cg_transactions").insert({
        tg_id: raw.tg_id,
        amount: -balance,
        reason: `Left early: ${ad?.title ?? "task"}`,
      });
    }

    await tg("sendMessage", {
      chat_id: raw.tg_id,
      parse_mode: "HTML",
      disable_web_page_preview: true,
      text:
        `🚫 <b>Balance reset</b>\n\nYou left <b>${ad?.title ?? "a chat"}</b> before completing ${HOLD_DAYS} days.\n\n` +
        `All of your coins have been removed (−${balance.toLocaleString("en-US")} ${COIN}). ` +
        `Stay in every channel and group you join for at least ${HOLD_DAYS} days to keep your earnings.`,
    });

    penalized += 1;
  }

  return { checked, penalized };
}
