// Run: node --test
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

// n8n runs Code-node scripts as a function body, so the file uses a top-level `return`.
// We load it the same way here.
const code = fs.readFileSync(new URL("../n8n/route.js", import.meta.url), "utf8");
const mod = { exports: {} };
new Function("module", code)(mod);
const { routeCall } = mod.exports;
const sample = (n) => JSON.parse(fs.readFileSync(new URL(`../sample-calls/${n}.json`, import.meta.url), "utf8"));
const NOW = new Date("2026-10-16T06:00:00Z"); // 11:30 AM IST

test("resolved happy call: logged, no alert", () => {
  const r = routeCall(sample("01_cancel_resolved"), NOW);
  assert.equal(r.needs_follow_up, false);
  assert.equal(r.Priority, "LOW");
  assert.equal(r["Follow-up"], "No");
  assert.equal(r.alert_text, "");
  assert.equal(r["Order ID"], "ORD-103");
});

test("angry escalated call: URGENT with a 2-hour reply time", () => {
  const r = routeCall(sample("02_damaged_escalated_angry"), NOW);
  assert.equal(r.needs_follow_up, true);
  assert.equal(r.Priority, "URGENT");
  assert.match(r.alert_text, /URGENT follow-up: Rahul Verma \(ORD-102\)/);
  assert.match(r.alert_text, /unhappy customer/);
  assert.match(r["Reply By"], /1:30\s?pm/i); // 11:30 AM IST + 2 h
});

test("policy decline handled calmly needs no follow-up", () => {
  const r = routeCall(sample("03_return_declined"), NOW);
  assert.equal(r.needs_follow_up, false);
});

test("caller who hung up immediately is logged but not escalated", () => {
  const r = routeCall(sample("04_hung_up"), NOW);
  assert.equal(r.needs_follow_up, false);
  assert.equal(r.Customer, "");
});

test("unresolved neutral call is MEDIUM with 24 h reply", () => {
  const r = routeCall({ customer_intent: "PRODUCT_QUERY", resolution_status: "unresolved", call_id: "C1" }, NOW);
  assert.equal(r.Priority, "MEDIUM");
  assert.equal(r.Status, "UNRESOLVED");
  assert.match(r.alert_text, /Unknown customer/);
});

test("missing fields don't crash", () => {
  const r = routeCall({}, NOW);
  assert.equal(r.Status, "UNKNOWN");
  assert.equal(r.needs_follow_up, false);
});

test("sheet columns are stable", () => {
  const cols = Object.keys(routeCall({}, NOW)).filter((k) => !["needs_follow_up", "alert_text"].includes(k));
  assert.deepEqual(cols, ["Logged At", "Call ID", "Customer", "Order ID", "Product", "Intent", "Status",
    "Sentiment", "Priority", "Follow-up", "Reply By", "Duration (s)", "Summary", "Actions"]);
});
