import { createFileRoute } from "@tanstack/react-router";
import { createClient } from "@supabase/supabase-js";
import { authenticateCronRequest } from "@/integrations/supabase/cron-auth";

const COIN = "CG";
const BATCH = 200;
const HOLD_DAYS = 7;

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

function chatRefFromAd(ad: any): string | number | null {
  if (ad?.src_chat) return Number(ad.src_chat);
  const link: string = ad?.link ?? "";
  const priv = link.match(/t\.me\/c\/(\d+)/);
  if (priv) return Number(`-100${priv[1]}`);
  const pub = link.match(/t\.me\/([A-Za-z0-9_]{4,})/);
  if (pub) return `@${pub[1]}`;
  return null;
}

export const Route = createFileRoute("/api/public/cron/leave-check")({
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

        const since = new Date(Date.now() - HOLD_DAYS * 24 * 60 * 60 * 1000).toISOString();

        const { data: rows, error } = await supabase
          .from("cg_completions")
          .select("id, ad_id, tg_id, created_at, cg_ads!inner(id, title, link, src_chat, category)")
          .gte("created_at", since)
          .in("cg_ads.category", ["channels", "groups"])
          .order("created_at", { ascending: true })
          .limit(BATCH);

        if (error) return Response.json({ ok: false, error: error.message }, { status: 500 });

        let penalized = 0;
        let checked = 0;

        for (const raw of (rows ?? []) as any[]) {
          const ad = Array.isArray(raw.cg_ads) ? raw.cg_ads[0] : raw.cg_ads;
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

        return Response.json({ ok: true, checked, penalized });
      },
    },
  },
});
