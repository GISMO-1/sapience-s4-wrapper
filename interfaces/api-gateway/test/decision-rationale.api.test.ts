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

test("decision rationale endpoints return execution decisions", async () => {
  setEnv({
    EXECUTION_GATING_ENABLED: "false",
    EXECUTION_MODE: "simulate",
    USE_INMEMORY_STORE: "true"
  });

  const app = await buildApp();
  const intentResponse = await app.inject({
    method: "POST",
    url: "/v1/intent",
    payload: { text: "create a PO for 3 monitors" }
  });
  expect(intentResponse.statusCode).toBe(200);
  const traceId = intentResponse.json().traceId;

  const listResponse = await app.inject({
    method: "GET",
    url: `/v1/trace/${traceId}/decisions`
  });
  expect(listResponse.statusCode).toBe(200);
  const listPayload = listResponse.json();
  expect(Array.isArray(listPayload.decisions)).toBe(true);
  expect(listPayload.decisions.length).toBeGreaterThan(0);

  const decisionId = listPayload.decisions[0]?.decisionId as string;
  const decisionResponse = await app.inject({
    method: "GET",
    url: `/v1/decision/${decisionId}`
  });
  expect(decisionResponse.statusCode).toBe(200);
  const decisionPayload = decisionResponse.json();
  expect(decisionPayload.rationale.decisionId).toBe(decisionId);

  const markdownResponse = await app.inject({
    method: "GET",
    url: `/v1/decision/${decisionId}?format=md`
  });
  expect(markdownResponse.statusCode).toBe(200);
  expect(markdownResponse.headers["content-type"]).toContain("text/markdown");
  expect(markdownResponse.body).toContain("Decision Rationale");

  await app.close();
});
