// Regenerates bot/src/handler.ts from the Lovable webhook route so the bot logic
// stays identical while the storage layer becomes MongoDB.
// Run from the repo root:  node bot/tools/sync-handler.mjs
import { readFileSync, writeFileSync } from "node:fs";

const SRC = "src/routes/api/public/telegram/webhook.ts";
const OUT = "bot/src/handler.ts";

let code = readFileSync(SRC, "utf8");

code = code.replace(/^import \{ createFileRoute \}.*\n/m, "");
code = code.replace(
  /^import \{ createClient \} from "@supabase\/supabase-js";$/m,
  'import { createClient } from "./mongo.js";',
);

// Swap the Supabase service-role client for the Mongo-backed one.
code = code.replace(
  /function db\(\) \{[\s\S]*?\n\}/,
  `function db() {\n  return createClient();\n}`,
);

const routeStart = code.indexOf("export const Route = createFileRoute(");
if (routeStart === -1) throw new Error("route export not found");
const routeBlock = code.slice(routeStart);
code = code.slice(0, routeStart);

const tryStart = routeBlock.indexOf("        try {");
const tryEnd = routeBlock.indexOf("        return Response.json({ ok: true });");
if (tryStart === -1 || tryEnd === -1) throw new Error("handler body not found");
const body = routeBlock
  .slice(tryStart, tryEnd)
  .split("\n")
  .map((line) => (line.startsWith("        ") ? line.slice(6) : line))
  .join("\n")
  .trimEnd();

code += `export { deriveSecret, safeEqual };

export async function handleUpdate(update: any): Promise<void> {
  const handled =
    update.pre_checkout_query ||
    update.callback_query ||
    update.my_chat_member ||
    update.message ||
    update.edited_message;
  if (!handled) return;

  const supabase = db();
  const settingsPromise = loadSettings(supabase);

  if (typeof update.update_id === "number") {
    const { error } = await supabase
      .from("cg_telegram_updates")
      .insert({ update_id: update.update_id });
    if (error) return; // duplicate delivery
  }

${body}
}
`;

writeFileSync(OUT, code);
console.log(`wrote ${OUT} (${code.split("\n").length} lines)`);
