/**
 * README
 * Purpose: Generate a deterministic golden demo snapshot using the API gateway in-process Fastify app.
 * Inputs: None required. Optional flags: --self-check, --help.
 * Outputs: artifacts/golden-demo.json and artifacts/golden-demo.md in the repo root.
 *
 * Example:
 *   pnpm -C interfaces/api-gateway exec tsx ../../scripts/golden-demo.ts
 *
 * Self-check:
 *   pnpm -C interfaces/api-gateway exec tsx ../../scripts/golden-demo.ts --self-check
 */

import { existsSync } from "node:fs";
import path from "node:path";
import { buildGoldenDemoSnapshot, writeGoldenArtifacts } from "../interfaces/api-gateway/src/testing/golden-demo";

const args = new Set(process.argv.slice(2));

async function selfCheck(): Promise<void> {
  const snapshot = await buildGoldenDemoSnapshot({ restoreEnv: true });
  if (snapshot.manifest.intents.length < 12) {
    throw new Error("Expected at least 12 intents in the golden snapshot.");
  }
  if (!snapshot.responses.policyCurrent) {
    throw new Error("Missing policyCurrent response in golden snapshot.");
  }
  console.log("✅ Golden demo self-check passed.");
}

async function main(): Promise<void> {
  if (args.has("--help")) {
    console.log("Usage: pnpm -C interfaces/api-gateway exec tsx ../../scripts/golden-demo.ts [--self-check]");
    return;
  }

  if (args.has("--self-check")) {
    await selfCheck();
    return;
  }

  const snapshot = await buildGoldenDemoSnapshot();

  let current = process.cwd();
  while (!existsSync(path.join(current, "pnpm-workspace.yaml"))) {
    const parent = path.dirname(current);
    if (parent === current) {
      throw new Error("Unable to locate repo root (pnpm-workspace.yaml not found).");
    }
    current = parent;
  }
  const artifactsDir = path.join(current, "artifacts");
  writeGoldenArtifacts(snapshot, artifactsDir);
  console.log(`Golden demo snapshot written to ${artifactsDir}`);
}

main().catch((error) => {
  console.error("Golden demo generation failed:", error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
