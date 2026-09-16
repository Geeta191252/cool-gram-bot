import http from "node:http";
import { handleUpdate, deriveSecret, safeEqual } from "./handler.js";
import { runBoostReminders, runLeaveCheck, runAutoApprove } from "./crons.js";
import { getDb } from "./mongo.js";
import {
  handleSupportUpdate,
  supportEnabled,
  supportToken,
  SUPPORT_WEBHOOK_PATH,
} from "./support.js";

const PORT = Number(process.env["PORT"] ?? 8000);
const WEBHOOK_PATH = process.env["WEBHOOK_PATH"] ?? "/telegram/webhook";
const BOT_TOKEN = process.env["TELEGRAM_BOT_TOKEN"] ?? process.env["COOLGRAM_BOT_TOKEN"] ?? "";
const PUBLIC_URL = (process.env["PUBLIC_URL"] ?? "").replace(/\/+$/, "");

function readBody(req: http.IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let data = "";
    req.on("data", (chunk) => {
      data += chunk;
      if (data.length > 2_000_000) req.destroy();
    });
    req.on("end", () => resolve(data));
    req.on("error", reject);
  });
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url ?? "/", "http://localhost");

  if (req.method === "GET" && (url.pathname === "/" || url.pathname === "/health")) {
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ ok: true, service: "coolgram-bot" }));
    return;
  }

  if (req.method === "POST" && url.pathname === WEBHOOK_PATH) {
    const expected = deriveSecret(BOT_TOKEN);
    const actual = String(req.headers["x-telegram-bot-api-secret-token"] ?? "");
    if (!safeEqual(actual, expected)) {
      res.writeHead(401).end("Unauthorized");
      return;
    }

    // Answer Telegram immediately; process the update in the background.
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ ok: true }));

    try {
      const update = JSON.parse(await readBody(req));
      await handleUpdate(update);
    } catch (err) {
      console.error("Cool Gram update failed", err);
    }
    return;
  }

  if (req.method === "POST" && url.pathname === SUPPORT_WEBHOOK_PATH && supportEnabled()) {
    const expected = deriveSecret(supportToken());
    const actual = String(req.headers["x-telegram-bot-api-secret-token"] ?? "");
    if (!safeEqual(actual, expected)) {
      res.writeHead(401).end("Unauthorized");
      return;
    }
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ ok: true }));
    try {
      const update = JSON.parse(await readBody(req));
      await handleSupportUpdate(update);
    } catch (err) {
      console.error("Support update failed", err);
    }
    return;
  }

  res.writeHead(404).end("Not found");
});

async function registerWebhook() {
  if (!PUBLIC_URL || !BOT_TOKEN) {
    console.warn("PUBLIC_URL or bot token missing — skipping setWebhook");
    return;
  }
  const res = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/setWebhook`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      url: `${PUBLIC_URL}${WEBHOOK_PATH}`,
      secret_token: deriveSecret(BOT_TOKEN),
      allowed_updates: ["message", "edited_message", "callback_query", "my_chat_member", "pre_checkout_query"],
      drop_pending_updates: false,
      max_connections: 60,
    }),
  });
  console.log("setWebhook:", await res.text());
}

async function registerSupportWebhook() {
  if (!PUBLIC_URL || !supportEnabled()) {
    console.warn("PUBLIC_URL or SUPPORT_BOT_TOKEN missing — skipping support setWebhook");
    return;
  }
  const token = supportToken();
  const res = await fetch(`https://api.telegram.org/bot${token}/setWebhook`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      url: `${PUBLIC_URL}${SUPPORT_WEBHOOK_PATH}`,
      secret_token: deriveSecret(token),
      allowed_updates: ["message", "edited_message", "callback_query"],
      drop_pending_updates: false,
      max_connections: 40,
    }),
  });
  console.log("support setWebhook:", await res.text());
}

function scheduleJob(name: string, everyMs: number, job: () => Promise<unknown>) {
  const run = async () => {
    try {
      console.log(`[cron] ${name}`, await job());
    } catch (err) {
      console.error(`[cron] ${name} failed`, err);
    }
  };
  setInterval(run, everyMs).unref?.();
  setTimeout(run, 30_000).unref?.();
}

async function main() {
  await getDb();
  server.listen(PORT, () => console.log(`Cool Gram bot listening on :${PORT}`));
  await registerWebhook();
  await registerSupportWebhook();
  scheduleJob("boost-reminders", 60 * 60 * 1000, runBoostReminders);
  scheduleJob("leave-check", 60 * 60 * 1000, runLeaveCheck);
  scheduleJob("auto-approve", 30 * 60 * 1000, runAutoApprove);
}

main().catch((err) => {
  console.error("Startup failed", err);
  process.exit(1);
});
