// Send sample call outcomes to the n8n webhook, exactly as Aria would after a call.
// Lets you test the whole workflow without making a single voice call.
//
//   node scripts/send-test-call.mjs                     # all samples to the test URL
//   node scripts/send-test-call.mjs 02                  # only the sample whose name starts with 02
//   N8N_WEBHOOK_URL=... ARIA_SECRET=... node scripts/send-test-call.mjs
//
// n8n has two URLs per webhook: /webhook-test/... works while you click "Listen for test event"
// in the editor; /webhook/... works once the workflow is activated (published).

import fs from "node:fs";

const url = process.env.N8N_WEBHOOK_URL || "http://localhost:5678/webhook-test/aria-call";
const secret = process.env.ARIA_SECRET || "change-me";
const filter = process.argv[2] || "";
const dir = new URL("../sample-calls/", import.meta.url);

for (const file of fs.readdirSync(dir).filter((f) => f.endsWith(".json") && f.startsWith(filter)).sort()) {
  const body = fs.readFileSync(new URL(file, dir), "utf8");
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Aria-Secret": secret },
      body,
    });
    console.log(`${res.status} ${res.statusText.padEnd(12)} ${file}  ${res.status === 404 ? "(is the workflow listening/active?)" : ""}`);
  } catch (e) {
    console.log(`FAILED  ${file}: ${e.cause?.code || e.message} (is n8n running on ${new URL(url).host}?)`);
  }
}
