const API_BASE = process.env.API_BASE ?? "http://localhost:8080";
const args = new Set(process.argv.slice(2));

const sampleIntents = [
  "create a PO for 25 laptops",
  "check inventory for AUTO-ITEM",
  "review invoice INV-2042 for $12,450",
  "request expedited shipment for order SO-3001",
  "create a purchase order for safety gloves",
  "check inventory for LAPTOP-15",
  "review invoice INV-7777 for $980",
  "request a PO for 3 monitors"
];

type JsonValue = Record<string, unknown>;

type IntentResponse = {
  traceId: string;
  policy?: {
    policyHash?: string;
    decision?: string;
  };
};

type ReplayResponse = {
  traceId: string;
  run?: {
    runId?: string;
  };
};

type PolicyCurrentResponse = {
  hash: string;
};

const jsonHeaders = {
  "content-type": "application/json"
};

const toUrl = (path: string) => new URL(path, API_BASE).toString();

const requestJson = async <T extends JsonValue>(path: string, options?: RequestInit): Promise<T> => {
  const response = await fetch(toUrl(path), options);
  const text = await response.text();
  let payload: T;

  try {
    payload = JSON.parse(text) as T;
  } catch (error) {
    throw new Error(
      `Expected JSON from ${path} but received: ${text.slice(0, 200)}${text.length > 200 ? "…" : ""}`
    );
  }

  if (!response.ok) {
    const message = typeof payload?.message === "string" ? payload.message : response.statusText;
    throw new Error(`[${response.status}] ${message}`);
  }

  return payload;
};

const checkHealth = async (): Promise<void> => {
  const response = await fetch(toUrl("/health"));
  if (!response.ok) {
    throw new Error(`Health check failed (${response.status} ${response.statusText})`);
  }
};

const selfCheck = async (): Promise<void> => {
  await checkHealth();
  console.log(`✅ API gateway reachable at ${API_BASE}`);
};

const main = async (): Promise<void> => {
  if (args.has("--help")) {
    console.log("Usage: pnpm -C interfaces/api-gateway exec tsx ../../scripts/seed-demo.ts [--self-check]");
    return;
  }

  if (args.has("--self-check")) {
    await selfCheck();
    return;
  }

  await checkHealth();

  console.log(`Seeding demo data against ${API_BASE}`);

  const intents: Array<{ text: string; traceId: string }> = [];

  for (const text of sampleIntents) {
    const response = await requestJson<IntentResponse>("/v1/intent", {
      method: "POST",
      headers: jsonHeaders,
      body: JSON.stringify({ text })
    });

    intents.push({ text, traceId: response.traceId });
    console.log(`• intent "${text}" → trace ${response.traceId}`);
  }

  const replay = await requestJson<ReplayResponse>("/v1/policy/replay", {
    method: "POST",
    headers: jsonHeaders,
    body: JSON.stringify({ requestedBy: "seed-demo" })
  });

  const runId = replay.run?.runId;
  if (!runId) {
    throw new Error("Replay run did not return a runId.");
  }

  await requestJson<JsonValue>(`/v1/policy/replay/${runId}/report`);

  const outcomes = [
    { traceId: intents[0]?.traceId, outcomeType: "success", severity: 1, humanOverride: false },
    { traceId: intents[1]?.traceId, outcomeType: "failure", severity: 3, humanOverride: false },
    { traceId: intents[2]?.traceId, outcomeType: "override", severity: 2, humanOverride: true }
  ].filter((entry) => entry.traceId);

  for (const outcome of outcomes) {
    await requestJson<JsonValue>("/v1/policy/outcomes", {
      method: "POST",
      headers: jsonHeaders,
      body: JSON.stringify({
        traceId: outcome.traceId,
        outcomeType: outcome.outcomeType,
        severity: outcome.severity,
        humanOverride: outcome.humanOverride,
        notes: "seed-demo"
      })
    });
  }

  const policyCurrent = await requestJson<PolicyCurrentResponse>("/v1/policy/current");
  const policyHash = policyCurrent.hash;

  await requestJson<JsonValue>(`/v1/policy/quality?policyHash=${encodeURIComponent(policyHash)}`);
  await requestJson<JsonValue>("/v1/policy/lineage/current");

  console.log("\nDone. Key links and IDs:");
  console.log(`• Replay run: ${runId}`);
  console.log(`• Replay report: ${toUrl(`/v1/policy/replay/${runId}/report`)}`);
  console.log(`• Policy hash: ${policyHash}`);
  console.log(`• Policy quality: ${toUrl(`/v1/policy/quality?policyHash=${encodeURIComponent(policyHash)}`)}`);
  console.log(`• Policy lineage: ${toUrl("/v1/policy/lineage/current")}`);
  console.log("• Web portal: http://localhost:5173");
};

main().catch((error) => {
  console.error("Seed demo failed:", error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
