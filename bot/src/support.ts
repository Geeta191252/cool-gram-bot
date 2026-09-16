import { getDb } from "./mongo.js";

const TOKEN = process.env["SUPPORT_BOT_TOKEN"] ?? "";
const OWNER_TG = Number(process.env["SUPPORT_OWNER_TG"] ?? process.env["OWNER_TG"] ?? 6965488457);

export const SUPPORT_WEBHOOK_PATH = process.env["SUPPORT_WEBHOOK_PATH"] ?? "/support/webhook";

async function tg(method: string, payload: Record<string, unknown>) {
  if (!TOKEN) return null;
  try {
    const res = await fetch(`https://api.telegram.org/bot${TOKEN}/${method}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
    });
    return (await res.json()) as any;
  } catch (err) {
    console.error("support tg failed", method, err);
    return null;
  }
}

type MapDoc = {
  owner_msg_id: number;
  user_id: number;
  user_name: string;
  created_at: Date;
};

async function mapCol() {
  const db = await getDb();
  const col = db.collection<MapDoc>("cg_support_map");
  await col.createIndex({ owner_msg_id: 1 }, { unique: true }).catch(() => {});
  return col;
}

function displayName(from: any) {
  const name = [from?.first_name, from?.last_name].filter(Boolean).join(" ") || "User";
  return from?.username ? `${name} (@${from.username})` : name;
}

export async function handleSupportUpdate(update: any) {
  const msg = update?.message ?? update?.edited_message;
  if (!msg?.chat?.id) return;
  const chatId = Number(msg.chat.id);
  const text: string = msg.text ?? "";

  if (chatId === OWNER_TG) {
    const replyTo = msg.reply_to_message?.message_id;
    if (!replyTo) {
      if (text.startsWith("/start")) {
        await tg("sendMessage", {
          chat_id: chatId,
          text: "🛠 Support console.\n\nEvery user message arrives here. Reply to a forwarded message and your reply is delivered to that user.",
        });
      }
      return;
    }
    const col = await mapCol();
    const link = await col.findOne({ owner_msg_id: Number(replyTo) });
    if (!link) {
      await tg("sendMessage", {
        chat_id: chatId,
        text: "⚠️ Could not find the user for this message. Reply directly to the forwarded user message.",
      });
      return;
    }
    const sent: any = await tg("copyMessage", {
      chat_id: link.user_id,
      from_chat_id: chatId,
      message_id: msg.message_id,
    });
    await tg("sendMessage", {
      chat_id: chatId,
      text: sent?.ok
        ? `✅ Reply delivered to ${link.user_name}.`
        : `❌ Could not deliver the reply to ${link.user_name}. The user may have blocked the bot.`,
      reply_to_message_id: msg.message_id,
    });
    return;
  }

  if (text.startsWith("/start")) {
    await tg("sendMessage", {
      chat_id: chatId,
      text:
        "🆘 <b>Cool Gram Support</b>\n\nDescribe your problem here — you can send a message, a photo or a video.\n\nOur team reads everything and will reply to you in this chat.",
      parse_mode: "HTML",
    });
    return;
  }

  const header: any = await tg("sendMessage", {
    chat_id: OWNER_TG,
    text: `🆘 <b>Support message</b>\nFrom: ${displayName(msg.from)}\nID: <code>${chatId}</code>`,
    parse_mode: "HTML",
  });

  const copied: any = await tg("copyMessage", {
    chat_id: OWNER_TG,
    from_chat_id: chatId,
    message_id: msg.message_id,
    reply_to_message_id: header?.result?.message_id,
  });

  const ownerMsgId = copied?.result?.message_id;
  if (ownerMsgId) {
    const col = await mapCol();
    await col.updateOne(
      { owner_msg_id: Number(ownerMsgId) },
      {
        $set: {
          owner_msg_id: Number(ownerMsgId),
          user_id: chatId,
          user_name: displayName(msg.from),
          created_at: new Date(),
        },
      },
      { upsert: true },
    );
    if (header?.result?.message_id) {
      await col.updateOne(
        { owner_msg_id: Number(header.result.message_id) },
        {
          $set: {
            owner_msg_id: Number(header.result.message_id),
            user_id: chatId,
            user_name: displayName(msg.from),
            created_at: new Date(),
          },
        },
        { upsert: true },
      );
    }
    await tg("sendMessage", {
      chat_id: chatId,
      text: "✅ Your message has been sent to the Cool Gram team. You will get a reply here soon.",
    });
  } else {
    await tg("sendMessage", {
      chat_id: chatId,
      text: "⚠️ We could not deliver your message right now. Please try again in a moment.",
    });
  }
}

export function supportEnabled() {
  return Boolean(TOKEN);
}

export function supportToken() {
  return TOKEN;
}
