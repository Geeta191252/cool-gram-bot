import { getDb } from "./mongo.js";

const TOKEN = process.env["SUPPORT_BOT_TOKEN"] ?? "";
const OWNER_TG = Number(process.env["SUPPORT_OWNER_TG"] ?? process.env["OWNER_TG"] ?? 6965488457);

export const SUPPORT_WEBHOOK_PATH = process.env["SUPPORT_WEBHOOK_PATH"] ?? "/support/webhook";

const INTRO_VIDEO_URL =
  "https://project--df5c0224-0a9b-491a-a8d1-60dc4387ca37-dev.lovable.app/__l5e/assets-v1/44cc983b-29b2-4358-a478-976fbd96ea23/coolgram-intro-v2.mp4";

const SPONSOR_CHANNEL = "@CoolGramAdvertise";
const SPONSOR_LINK = "https://t.me/CoolGramAdvertise";

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

async function isSponsorMember(userId: number): Promise<boolean> {
  try {
    const res: any = await tg("getChatMember", { chat_id: SPONSOR_CHANNEL, user_id: userId });
    const status = res?.result?.status;
    return Boolean(res?.ok && ["member", "administrator", "creator", "restricted"].includes(status));
  } catch {
    return false;
  }
}

async function sponsorPrompt(chatId: number) {
  await tg("sendMessage", {
    chat_id: chatId,
    text: `🔒 <b>Join our channel first</b>\n\nTo contact Cool Gram Support, please join our channel ${SPONSOR_CHANNEL}, then tap "✅ I joined".`,
    parse_mode: "HTML",
    reply_markup: {
      inline_keyboard: [
        [{ text: "📢 Join channel", url: SPONSOR_LINK }],
        [{ text: "✅ I joined", callback_data: "chkjoin" }],
      ],
    },
  });
}

async function sendStart(chatId: number, firstName?: string) {
  const caption =
    `👋 <b>${firstName ?? "friend"}, welcome to Cool Gram Support!</b>\n\n` +
    `Describe your problem here — you can send a message, a photo or a video.\n\n` +
    `Our team reads everything and will reply to you in this chat.`;
  const video: any = await tg("sendVideo", {
    chat_id: chatId,
    video: INTRO_VIDEO_URL,
    caption,
    parse_mode: "HTML",
  });
  if (!video?.ok) {
    await tg("sendMessage", { chat_id: chatId, text: caption, parse_mode: "HTML" });
  }
}

export async function handleSupportUpdate(update: any) {
  // Join-gate verification button
  const cb = update?.callback_query;
  if (cb) {
    const cbChatId = Number(cb.message?.chat?.id ?? cb.from?.id);
    const userId = Number(cb.from?.id);
    if (cb.data === "chkjoin" && cbChatId) {
      const ok = await isSponsorMember(userId);
      if (ok) {
        await tg("answerCallbackQuery", { callback_query_id: cb.id, text: "✅ Verified!" });
        await tg("sendMessage", {
          chat_id: cbChatId,
          text: "✅ Thanks for joining! You can now send your message, photo or video to Cool Gram Support.",
        });
      } else {
        await tg("answerCallbackQuery", {
          callback_query_id: cb.id,
          text: "❌ You have not joined the channel yet.",
          show_alert: true,
        });
      }
    } else {
      await tg("answerCallbackQuery", { callback_query_id: cb.id });
    }
    return;
  }

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
    await sendStart(chatId, msg.from?.first_name);
    if (!(await isSponsorMember(chatId))) {
      await sponsorPrompt(chatId);
    }
    return;
  }

  // Gate: user must be in the sponsor channel before sending anything
  if (!(await isSponsorMember(chatId))) {
    await sponsorPrompt(chatId);
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
