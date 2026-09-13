import { createFileRoute } from "@tanstack/react-router";
import { createClient } from "@supabase/supabase-js";
import { authenticateCronRequest } from "@/integrations/supabase/cron-auth";

const COIN = "CG";
const BATCH = 50;

function db() {
  return createClient(process.env["SUPABASE_URL"]!, process.env["SUPABASE_SERVICE_ROLE_KEY"]!, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

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

export const Route = createFileRoute("/api/public/cron/boost-reminders")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const supabase = db();

        const headerToken = request.headers.get("x-cron-token") ?? "";
        let authorized = false;
        if (headerToken) {
          const { data: tokenRow } = await supabase
            .from("cg_cron_tokens")
            .select("id")
            .eq("token", headerToken)
            .maybeSingle();
          authorized = Boolean(tokenRow);
        }
        if (!authorized) {
          const unauthorized = await authenticateCronRequest(request);
          if (unauthorized) return unauthorized;
        }

        const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

        const { data: claims, error } = await supabase
          .from("cg_boost_claims")
          .select("id, ad_id, tg_id, days_claimed, total_days, last_claim_at, reminded_at")
          .eq("status", "active")
          .lt("last_claim_at", cutoff)
          .order("last_claim_at", { ascending: true })
          .limit(BATCH);

        if (error) return Response.json({ ok: false, error: error.message }, { status: 500 });

        let sent = 0;
        for (const raw of (claims ?? []) as any[]) {
          // Skip if already reminded after the last payout
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

        return Response.json({ ok: true, sent });
      },
    },
  },
});
