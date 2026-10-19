// Builds n8n/aria-crm-workflow.json, copying n8n/route.js into the Code node.
// Run after editing route.js:  node scripts/build-workflow.mjs
//
// Flow:
//   Webhook (POST /webhook/aria-call, header secret)
//     └─► Code: prepare row + priority
//           ├─► Google Sheets: append to "Calls" tab          (every call)
//           └─► IF needs follow-up?
//                 ├─ yes ─► Twilio WhatsApp to support lead
//                 │      └► Email to support inbox
//                 └─ no ──► (nothing)

import fs from "node:fs";

const route = fs.readFileSync(new URL("../n8n/route.js", import.meta.url), "utf8");

const node = (name, type, typeVersion, position, parameters, extra = {}) => ({
  id: name.toLowerCase().replace(/[^a-z0-9]+/g, "-"),
  name, type, typeVersion, position, parameters, ...extra,
});

const nodes = [
  node("Aria call ended", "n8n-nodes-base.webhook", 2, [0, 300], {
    httpMethod: "POST",
    path: "aria-call",
    authentication: "headerAuth",       // credential: Name = X-Aria-Secret, Value = your secret
    responseMode: "onReceived",
    options: {},
  }, { webhookId: "aria-call" }),

  node("Prepare row & priority", "n8n-nodes-base.code", 2, [240, 300], {
    mode: "runOnceForAllItems",
    language: "javaScript",
    jsCode: route,
  }),

  node("Log call to Google Sheet", "n8n-nodes-base.googleSheets", 4.5, [520, 160], {
    operation: "append",
    documentId: { __rl: true, mode: "url", value: "PASTE_YOUR_GOOGLE_SHEET_URL" },
    sheetName: { __rl: true, mode: "name", value: "Calls" },
    columns: { mappingMode: "autoMapInputData", value: {}, matchingColumns: [], schema: [] },
    options: { handlingExtraData: "ignoreIt" },   // skip needs_follow_up / alert_text (not sheet columns)
  }),

  node("Needs follow-up?", "n8n-nodes-base.if", 2, [520, 440], {
    conditions: {
      options: { caseSensitive: true, leftValue: "", typeValidation: "strict" },
      conditions: [{
        id: "needs-follow-up",
        leftValue: "={{ $json.needs_follow_up }}",
        rightValue: "",
        operator: { type: "boolean", operation: "true", singleValue: true },
      }],
      combinator: "and",
    },
    options: {},
  }),

  node("WhatsApp support lead", "n8n-nodes-base.twilio", 1, [800, 360], {
    from: "+14155238886",              // Twilio WhatsApp sandbox number
    to: "+91XXXXXXXXXX",               // support lead's WhatsApp (must have joined the sandbox)
    toWhatsapp: true,
    message: "={{ $json.alert_text }}",
    options: {},
  }),

  node("Email support inbox", "n8n-nodes-base.emailSend", 2.1, [1060, 360], {
    fromEmail: "you@gmail.com",
    toEmail: "support-team@example.com",
    subject: "={{ $json.Priority }} follow-up: {{ $json.Customer || $json['Order ID'] || $json['Call ID'] }}",
    emailFormat: "text",
    text: "={{ $json.alert_text }}\n\nFull call log: PASTE_YOUR_GOOGLE_SHEET_URL",
    options: {},
  }),
];

const connections = {
  "Aria call ended": { main: [[{ node: "Prepare row & priority", type: "main", index: 0 }]] },
  "Prepare row & priority": {
    main: [[
      { node: "Log call to Google Sheet", type: "main", index: 0 },
      { node: "Needs follow-up?", type: "main", index: 0 },
    ]],
  },
  "Needs follow-up?": { main: [[{ node: "WhatsApp support lead", type: "main", index: 0 }], []] },
  "WhatsApp support lead": { main: [[{ node: "Email support inbox", type: "main", index: 0 }]] },
};

const workflow = {
  name: "Aria → CRM: log calls and alert on follow-ups",
  nodes,
  connections,
  settings: { executionOrder: "v1" },
  pinData: {},
  active: false,
};

fs.writeFileSync(new URL("../n8n/aria-crm-workflow.json", import.meta.url), JSON.stringify(workflow, null, 2) + "\n");
console.log(`Wrote n8n/aria-crm-workflow.json (${nodes.length} nodes)`);
