import OpenAI from "openai";
import { openAiKey, OPENAI_KEY_COMMAND } from "../apps/server/src/ai/keys.js";
import { config } from "../apps/server/src/config.js";

/** Lists the OpenAI models this key can use, to confirm the configured one is there. Usage: npm run ai:models */
const key = openAiKey();
if (key === null) {
  console.error(`No OpenAI key yet. Add it with ${OPENAI_KEY_COMMAND}.`);
  process.exit(1);
}
const client = new OpenAI({ apiKey: key });
const ids: string[] = [];
for await (const model of client.models.list()) ids.push(model.id);
const chat = ids.filter((id) => /^(gpt|o\d)/.test(id)).sort();
console.log(chat.join("\n"));
console.log(`\nConfigured: ${config.openai.model} (${ids.includes(config.openai.model) ? "available to this key" : "NOT available to this key"})`);
