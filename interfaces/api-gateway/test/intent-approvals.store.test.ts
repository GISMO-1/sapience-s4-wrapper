import { expect, test } from "vitest";
import { InMemoryIntentApprovalStore } from "../src/intent-approvals/store";

const baseInput = {
  traceId: "trace-1",
  intentId: "intent-1",
  policyHash: "policy-hash",
  decisionId: "decision-1",
  requiredRole: "FINANCE_REVIEWER",
  actor: "local-user",
  rationale: "Reviewed"
};

test("recordApproval is idempotent for the same decision", async () => {
  const store = new InMemoryIntentApprovalStore();
  const first = await store.recordApproval(baseInput);
  const second = await store.recordApproval(baseInput);

  expect(first.id).toBe(second.id);
  const approvals = await store.listApprovalsByTraceId("trace-1");
  expect(approvals).toHaveLength(1);
});

test("recordApproval stores distinct decisions separately", async () => {
  const store = new InMemoryIntentApprovalStore();
  await store.recordApproval(baseInput);
  await store.recordApproval({ ...baseInput, decisionId: "decision-2" });

  const approvals = await store.listApprovalsByTraceId("trace-1");
  expect(approvals).toHaveLength(2);
});
