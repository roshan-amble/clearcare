import { appendMessage, buildChatRequest, dateOf, localNow, sampleState, startThread, validateChat } from "@clearcare/domain";
import { chooseProvider } from "../apps/server/src/ai/provider.js";

/**
 * A real run against the fictional sample patient: proves the AI connection, the prompt and the validator work end
 * to end. It writes nothing. Usage: npm run ai:check -- "your question"
 */
const question = process.argv[2] ?? "She's been feeling sluggish and weak this week, and her left arm hurts today. Could it be her medications?";
const now = localNow(new Date());
const { provider, note } = chooseProvider();
if (provider === null) {
  console.error(note);
  process.exit(1);
}
let state = sampleState(now);
const started = startThread(state, question, now);
state = appendMessage(started.state, started.threadId, { role: "user", text: question, runId: null }, now);
const thread = state.threads.find((t) => t.id === started.threadId)!;
const request = buildChatRequest(state, thread, dateOf(now), now);
console.log(`${provider.description}, effort ${provider.chatEffort}. Red-flag floor: ${request.flags.level ?? "none"}.`);
const t0 = Date.now();
const result = await provider.call({ system: request.system, context: request.context, messages: request.messages, schema: request.schema, job: "chat" });
const seconds = ((Date.now() - t0) / 1000).toFixed(1);
if (!result.ok) {
  console.error(`FAILED after ${seconds} s: ${result.error}`);
  process.exit(1);
}
const checked = validateChat(result.output, request, state);
console.log(`${checked.status} in ${seconds} s · ${result.usage.inputTokens} in / ${result.usage.outputTokens} out tokens${result.usage.costUsd === null ? "" : ` · ≈$${result.usage.costUsd.toFixed(3)}`}`);
for (const reason of checked.reasons) console.log(`  refused: ${reason}`);
for (const warning of checked.warnings) console.log(`  warning: ${warning}`);
console.log(JSON.stringify(checked.output, null, 2));
process.exit(checked.status === "SUCCEEDED" ? 0 : 1);
