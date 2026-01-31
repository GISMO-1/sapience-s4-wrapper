import Fastify from "fastify";
import { afterEach, expect, test, vi } from "vitest";

async function buildApp() {
  const { registerRoutes } = await import("../src/routes");
  const app = Fastify();
  await registerRoutes(app);
  await app.ready();
  return app;
}

function setEnv(values: Record<string, string | undefined>) {
  for (const [key, value] of Object.entries(values)) {
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }
}

afterEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
  setEnv({
    EXECUTION_GATING_ENABLED: undefined,
    EXECUTION_MODE: undefined,
    USE_INMEMORY_STORE: undefined
  });
});

test("execute requires approvals before auto execution", async () => {
  setEnv({
    EXECUTION_GATING_ENABLED: "true",
    EXECUTION_MODE: "auto",
    USE_INMEMORY_STORE: "true"
  });

  const app = await buildApp();
  const intentResponse = await app.inject({
    method: "POST",
    url: "/v1/intent",
    payload: { text: "review invoice amount 75000" }
  });
  expect(intentResponse.statusCode).toBe(200);
  const traceId = intentResponse.json().traceId;

  const executeResponse = await app.inject({
    method: "POST",
    url: `/v1/intent/${traceId}/execute`
  });
  expect(executeResponse.statusCode).toBe(409);
  const executePayload = executeResponse.json();
  expect(Array.isArray(executePayload.missingApprovals)).toBe(true);

  for (const role of executePayload.missingApprovals as string[]) {
    const approvalResponse = await app.inject({
      method: "POST",
      url: `/v1/intent/${traceId}/approve`,
      payload: { role, actor: "local-user", rationale: "Reviewed" }
    });
    expect(approvalResponse.statusCode).toBe(200);
  }

  const executeAfter = await app.inject({
    method: "POST",
    url: `/v1/intent/${traceId}/execute`
  });
  expect(executeAfter.statusCode).toBe(200);

  await app.close();
});

test("approving a non-required role returns 400", async () => {
  setEnv({
    EXECUTION_GATING_ENABLED: "true",
    EXECUTION_MODE: "auto",
    USE_INMEMORY_STORE: "true"
  });

  const app = await buildApp();
  const intentResponse = await app.inject({
    method: "POST",
    url: "/v1/intent",
    payload: { text: "review invoice amount 75000" }
  });
  const traceId = intentResponse.json().traceId;

  const approvalResponse = await app.inject({
    method: "POST",
    url: `/v1/intent/${traceId}/approve`,
    payload: { role: "OPS_REVIEWER", actor: "local-user", rationale: "Reviewed" }
  });
  expect(approvalResponse.statusCode).toBe(400);

  await app.close();
});

test("approvals are idempotent per role and actor", async () => {
  setEnv({
    EXECUTION_GATING_ENABLED: "true",
    EXECUTION_MODE: "auto",
    USE_INMEMORY_STORE: "true"
  });

  const app = await buildApp();
  const intentResponse = await app.inject({
    method: "POST",
    url: "/v1/intent",
    payload: { text: "review invoice amount 75000" }
  });
  const traceId = intentResponse.json().traceId;

  const decisionResponse = await app.inject({
    method: "GET",
    url: `/v1/intent/${traceId}/decision`
  });
  const requiredRole = decisionResponse.json().decision.requiredApprovals[0]?.role;
  expect(requiredRole).toBeTruthy();

  const firstApproval = await app.inject({
    method: "POST",
    url: `/v1/intent/${traceId}/approve`,
    payload: { role: requiredRole, actor: "local-user", rationale: "Reviewed" }
  });
  const secondApproval = await app.inject({
    method: "POST",
    url: `/v1/intent/${traceId}/approve`,
    payload: { role: requiredRole, actor: "local-user", rationale: "Reviewed" }
  });

  expect(firstApproval.statusCode).toBe(200);
  expect(secondApproval.statusCode).toBe(200);
  const approvals = secondApproval.json().approvals.filter(
    (approval: { requiredRole: string; actor: string }) =>
      approval.requiredRole === requiredRole && approval.actor === "local-user"
  );
  expect(approvals).toHaveLength(1);

  await app.close();
});

test("gating disabled preserves prior intent behavior", async () => {
  setEnv({
    EXECUTION_GATING_ENABLED: "false",
    EXECUTION_MODE: "auto",
    USE_INMEMORY_STORE: "true"
  });

  const app = await buildApp();
  const response = await app.inject({
    method: "POST",
    url: "/v1/intent",
    payload: { text: "create a PO for 6000 units" }
  });
  expect(response.statusCode).toBe(200);
  const payload = response.json();
  expect(payload.result.message).toBe("Policy warning requires manual approval.");

  await app.close();
});
