// Business rules for each finished call. This exact code runs inside the n8n "Code" node
// (scripts/build-workflow.mjs copies it into the workflow), and the same file is unit-tested
// in test/route.test.mjs, so the rules in n8n and the tested rules can't drift apart.

const FOLLOW_UP_STATUSES = ["ESCALATED", "UNRESOLVED", "INCOMPLETE"];

function routeCall(call, now = new Date()) {
  const status = String(call.resolution_status || "UNKNOWN").toUpperCase();
  const sentiment = String(call.customer_sentiment || "NEUTRAL").toUpperCase();
  const hadConversation = String(call.customer_intent || "") !== "NO_INTERACTION";

  // Does a human need to act on this call?
  const reasons = [];
  if (call.follow_up_required === true) reasons.push("agent flagged a follow-up");
  if (hadConversation && FOLLOW_UP_STATUSES.includes(status)) reasons.push(`status ${status}`);
  if (sentiment === "NEGATIVE") reasons.push("unhappy customer");
  const needsFollowUp = reasons.length > 0;

  // How urgent? Unhappy + escalated first, then any unhappy or escalated call, then the rest.
  let priority = "LOW";
  if (needsFollowUp) priority = "MEDIUM";
  if (sentiment === "NEGATIVE" || status === "ESCALATED") priority = "HIGH";
  if (sentiment === "NEGATIVE" && status === "ESCALATED") priority = "URGENT";

  // Promise a reply time the support team can keep.
  const hoursToReply = { URGENT: 2, HIGH: 4, MEDIUM: 24, LOW: null }[priority];
  const replyBy = hoursToReply ? new Date(now.getTime() + hoursToReply * 3600 * 1000) : null;
  const ist = (d) => d.toLocaleString("en-IN", { timeZone: "Asia/Kolkata", dateStyle: "medium", timeStyle: "short" });

  const who = call.customer_name ? `${call.customer_name} (${call.order_id})` : call.order_id || "Unknown customer";
  const actions = Array.isArray(call.actions_taken) ? call.actions_taken : [];

  return {
    // Columns for the Google Sheet. The sheet's header row must use these exact names.
    "Logged At": ist(now),
    "Call ID": call.call_id || "",
    "Customer": call.customer_name || "",
    "Order ID": call.order_id || "",
    "Product": call.product || "",
    "Intent": call.customer_intent || "",
    "Status": status,
    "Sentiment": sentiment,
    "Priority": priority,
    "Follow-up": needsFollowUp ? "Yes" : "No",
    "Reply By": replyBy ? ist(replyBy) : "",
    "Duration (s)": call.duration_seconds ?? "",
    "Summary": call.call_summary || "",
    "Actions": actions.join("; "),
    // Used by the alert nodes, not written to the sheet.
    needs_follow_up: needsFollowUp,
    alert_text: needsFollowUp
      ? [
          `🔔 ${priority} follow-up: ${who}`,
          `Reason: ${reasons.join(", ")}`,
          `Issue: ${call.call_summary || "(no summary)"}`,
          actions.length ? `Done so far: ${actions.join("; ")}` : null,
          `Reply by: ${ist(replyBy)}`,
          `Call ID: ${call.call_id || "-"}`,
        ].filter(Boolean).join("\n")
      : "",
  };
}

// --- n8n entry point (ignored outside n8n) ---
// The Webhook node puts the POSTed JSON under "body".
if (typeof $input !== "undefined") {
  return $input.all().map((item) => ({ json: routeCall(item.json.body ?? item.json) }));
}

if (typeof module !== "undefined") module.exports = { routeCall };
