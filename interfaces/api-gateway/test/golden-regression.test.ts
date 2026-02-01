import { readFileSync } from "node:fs";
import path from "node:path";
import { expect, test, vi } from "vitest";
import { normalizeGoldenSnapshot } from "../src/testing/normalize";

const baselinePath = path.resolve(process.cwd(), "..", "..", "artifacts", "golden-baseline.json");

function diffSummary(current: Record<string, unknown>, baseline: Record<string, unknown>) {
  const currentKeys = Object.keys(current);
  const baselineKeys = Object.keys(baseline);
  const missingKeys = baselineKeys.filter((key) => !currentKeys.includes(key));
  const extraKeys = currentKeys.filter((key) => !baselineKeys.includes(key));
  const currentHashes = (current.hashes ?? {}) as Record<string, string>;
  const baselineHashes = (baseline.hashes ?? {}) as Record<string, string>;
  const allHashKeys = Array.from(new Set([...Object.keys(currentHashes), ...Object.keys(baselineHashes)])).sort();
  const changedHashes = allHashKeys
    .filter((key) => currentHashes[key] !== baselineHashes[key])
    .map((key) => ({
      key,
      baseline: baselineHashes[key],
      current: currentHashes[key]
    }));

  return { missingKeys, extraKeys, changedHashes };
}

test("golden demo snapshot matches baseline", async () => {
  vi.resetModules();

  let baseline: Record<string, unknown>;
  try {
    baseline = JSON.parse(readFileSync(baselinePath, "utf-8")) as Record<string, unknown>;
  } catch (error) {
    throw new Error(`Golden baseline missing or invalid at ${baselinePath}. Run: make golden`);
  }

  const { buildGoldenDemoSnapshot } = await import("../src/testing/golden-demo");
  const snapshot = await buildGoldenDemoSnapshot({ restoreEnv: true });
  const normalized = normalizeGoldenSnapshot(snapshot) as Record<string, unknown>;

  try {
    expect(normalized).toEqual(baseline);
  } catch (error) {
    const summary = diffSummary(normalized, baseline);
    if (summary.missingKeys.length || summary.extraKeys.length) {
      console.error("Golden snapshot top-level key mismatch:", summary);
    }
    if (summary.changedHashes.length) {
      console.error("Golden snapshot hash mismatches:", summary.changedHashes);
    }
    throw error;
  }
});
