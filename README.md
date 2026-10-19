# Aria → CRM automation (n8n)

When a call with **[Aria](https://github.com/Yash04Mehta/aura-voice-agent)**, my AI voice support agent for a skincare brand, ends, this workflow:

1. **logs the call** to a Google Sheet (customer, order, intent, outcome, sentiment, summary), and
2. if a human needs to act, **alerts the support team** on WhatsApp and email, with a priority and a reply-by time.

No one has to read transcripts to find the calls that need attention.

```
Aria (Next.js)                         n8n
──────────────                         ─────────────────────────────────────────────────────────
call ends → /api/summary  ──POST──►  Webhook /aria-call  (rejects requests without the secret header)
 (Gemini summary + order                  │
  details from the order DB)              ▼
                                       Code: business rules → priority, reply-by time, sheet row
                                          ├────────────► Google Sheets: append row to "Calls"   (every call)
                                          ▼
                                       IF needs follow-up?
                                          ├─ yes ─► Twilio WhatsApp → support lead ─► Email → support inbox
                                          └─ no ──► done
```

## Business rules

These live in `n8n/route.js`. The same file is unit-tested and copied into the n8n Code node.

A call **needs follow-up** if Aria flagged one, the outcome was ESCALATED, UNRESOLVED or INCOMPLETE (with a real conversation), or the customer was unhappy.

| Priority | When | Reply within |
|---|---|---|
| URGENT | unhappy **and** escalated | 2 hours |
| HIGH | unhappy **or** escalated | 4 hours |
| MEDIUM | other follow-ups | 24 hours |
| LOW | resolved, nothing to do | – |

Example alert (from `sample-calls/02_damaged_escalated_angry.json`):

```
🔔 URGENT follow-up: Rahul Verma (ORD-102)
Reason: agent flagged a follow-up, status ESCALATED, unhappy customer
Issue: Customer received a leaking sunscreen bottle and was upset about the delay. Aria raised a damage ticket.
Done so far: Looked up ORD-102; Raised ticket TKT-5521
Reply by: 16 Oct 2026, 1:30 pm
Call ID: CALL-261016113040
```

## Design decisions

- **The agent stays simple; the workflow holds the business process.** Aria only reports what happened. Who gets alerted, how fast, and where calls are logged are decided in n8n, where a non-developer can change them without redeploying the agent.
- **Can't slow down the call.** Aria sends the webhook *after* replying to the browser (Next.js `after()`) with a 5-second timeout. A slow or broken workflow never affects the customer.
- **Off by default.** Aria only sends anything when `CRM_WEBHOOK_URL` is set.
- **Secured.** A shared secret in the `X-Aria-Secret` header, checked by n8n's Header Auth, so random POSTs to the public webhook are rejected.
- **Enriched.** Aria adds the customer's name, product and order value from its order database, so the sheet and alerts make sense without opening the transcript.
- **Testable without calls.** `scripts/send-test-call.mjs` replays 4 sample call outcomes into the webhook.

## What's in this repo

```
aria-crm-automation/
├── n8n/
│   ├── aria-crm-workflow.json   import this into n8n
│   └── route.js                 the business rules (Code node source)
├── scripts/
│   ├── build-workflow.mjs       regenerates the workflow JSON after editing route.js
│   └── send-test-call.mjs       sends sample calls to the webhook
├── sample-calls/                4 call outcomes in the exact format Aria sends
├── aria-patch/                  the change to Aria (patch file + full copies of changed files)
└── test/route.test.mjs          7 tests for the business rules  (npm test)
```

The change to Aria is about 90 lines in 4 files: a new `lib/crm.ts`, plus small edits to `app/api/summary/route.ts`, `lib/useVoiceAgent.ts` and `.env.example`. It lives on Aria's `crm-automation` branch, separate from the deployed version.

## Running it locally

Requires Node 20+.

1. **Start n8n:** `npx n8n`, then open http://localhost:5678 and create the local owner account.
2. **Import:** Workflows → *Import from file* → `n8n/aria-crm-workflow.json`.
3. **Credentials** (open each node and pick or create one):
   - *Aria call ended*: **Header Auth**, Name `X-Aria-Secret`, Value = a long random string
   - *Log call to Google Sheet*: **Google Sheets OAuth2**. Then paste your sheet URL. The sheet needs a tab named `Calls` with this header row:
     `Logged At | Call ID | Customer | Order ID | Product | Intent | Status | Sentiment | Priority | Follow-up | Reply By | Duration (s) | Summary | Actions`
   - *WhatsApp support lead*: **Twilio** (Account SID + Auth Token). Set *To* to your number, which must have joined the Twilio WhatsApp sandbox.
   - *Email support inbox*: **SMTP** (Gmail: smtp.gmail.com, port 465, SSL, with an App Password)
4. **Test without Aria:** click *Execute workflow* (it waits for a test event), then run
   `ARIA_SECRET=<your secret> node scripts/send-test-call.mjs 02`
   (Windows PowerShell: `$env:ARIA_SECRET="<your secret>"; node scripts/send-test-call.mjs 02`)
5. **Connect Aria:** on Aria's `crm-automation` branch, add to `.env.local`:
   ```
   CRM_WEBHOOK_URL=http://localhost:5678/webhook/aria-call
   CRM_WEBHOOK_SECRET=<your secret>
   ```
   Activate the workflow, run Aria with `npm run dev`, make a call, and watch the row appear.

## Tests

`npm test` runs 7 tests of the business rules: priorities, reply-by times, alert text, the no-conversation case, missing fields, and stable sheet columns.

Also checked:
- **In real n8n (v2.43):** the workflow imports cleanly. Run with sample calls (Sheets, Twilio and email switched off), the escalated angry call goes down the follow-up branch as URGENT, and the resolved call is only logged.
- **On the Aria side:** running Aria locally against a test receiver, the payload arrives with the secret header and includes the customer name looked up from the order database.

## Limitations

- WhatsApp alerts use the Twilio sandbox, which only reaches numbers that joined it. Production needs an approved WhatsApp Business sender.
- Aria is a browser demo with no caller ID, so alerts go to the **support team**, not the customer. Customers are identified by the order they mention.
- If n8n is down when a call ends, that call isn't logged. Production would add a retry queue.

## Next steps

- Push to a real CRM (HubSpot, Zoho) instead of or alongside Sheets
- A daily summary message: calls handled, resolved %, open follow-ups
- Close the loop: mark the row "Done" when support replies
