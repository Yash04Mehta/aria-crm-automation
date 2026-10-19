// Optional CRM hand-off: after each call, send the outcome to an automation webhook (n8n).
//
// Off by default. Nothing happens unless CRM_WEBHOOK_URL is set, so the agent behaves
// exactly as before without it. The webhook runs after the response is sent (Next.js
// `after`), so a slow or broken CRM can never delay or break the customer's call screen.

import { ORDERS } from "@/lib/orders";

export interface CallMeta {
  call_id?: string;
  started_at?: string;
  duration_seconds?: number;
  ended_by?: string;
  customer_turns?: number;
  tools_called?: string[];
}

interface Line {
  role: string;
  text: string;
}

export function buildCrmPayload(
  summary: Record<string, unknown>,
  source: string,
  meta: CallMeta | undefined,
  transcript: Line[],
) {
  const orderId = typeof summary.order_id === "string" ? summary.order_id.toUpperCase() : null;
  // Enrich with what the business already knows about this order (customer name, product, value).
  const order = orderId ? ORDERS.find((o) => o.order_id === orderId) : undefined;
  return {
    event: "call.completed",
    agent: "aria",
    call_id: meta?.call_id ?? `CALL-${Date.now()}`,
    started_at: meta?.started_at ?? new Date().toISOString(),
    duration_seconds: meta?.duration_seconds ?? null,
    ended_by: meta?.ended_by ?? null,
    customer_intent: summary.customer_intent ?? null,
    resolution_status: summary.resolution_status ?? null,
    customer_sentiment: summary.customer_sentiment ?? null,
    follow_up_required: summary.follow_up_required === true,
    order_id: orderId,
    customer_name: order?.customer_name ?? null,
    product: order?.product ?? null,
    order_value_inr: order?.value_inr ?? null,
    policy_applied: summary.policy_applied ?? null,
    actions_taken: Array.isArray(summary.actions_taken) ? summary.actions_taken : [],
    call_summary: summary.call_summary ?? "",
    summary_source: source,
    transcript: transcript.map((l) => `${l.role.toUpperCase()}: ${l.text}`).join("\n").slice(0, 20000),
  };
}

export async function notifyCrm(payload: ReturnType<typeof buildCrmPayload>): Promise<void> {
  const url = process.env.CRM_WEBHOOK_URL;
  if (!url) return;
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        // Shared secret so the workflow can reject requests that didn't come from Aria.
        ...(process.env.CRM_WEBHOOK_SECRET ? { "X-Aria-Secret": process.env.CRM_WEBHOOK_SECRET } : {}),
      },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) console.error(`CRM webhook returned ${res.status}`);
  } catch (e) {
    console.error("CRM webhook failed", e);
  }
}
