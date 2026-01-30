import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import path from "node:path";
import { parse as parseYaml } from "yaml";
import { policyDocumentSchema } from "./schema";
import type { PolicyDocument, PolicyInfo } from "./types";

export type PolicySnapshot = {
  policy: PolicyDocument | null;
  info: PolicyInfo;
  source: "loaded" | "fallback";
};

export type PolicyLoader = {
  getSnapshot: () => PolicySnapshot;
  reload: () => PolicySnapshot;
};

const DEFAULT_POLICY_PATH = path.resolve(process.cwd(), "policies", "policies.v1.yaml");

function resolvePolicyPath(): string {
  return process.env.POLICY_PATH ? path.resolve(process.env.POLICY_PATH) : DEFAULT_POLICY_PATH;
}

function buildInfo(pathValue: string, hash: string, version: string, loadedAt: Date): PolicyInfo {
  return {
    version,
    hash,
    loadedAt: loadedAt.toISOString(),
    path: pathValue
  };
}

function loadPolicyFromDisk(): PolicySnapshot {
  const policyPath = resolvePolicyPath();
  const raw = readFileSync(policyPath, "utf-8");
  const parsed = parseYaml(raw);
  const policy = policyDocumentSchema.parse(parsed);
  const hash = createHash("sha256").update(raw).digest("hex");
  return {
    policy,
    info: buildInfo(policyPath, hash, policy.version, new Date()),
    source: "loaded"
  };
}

export function createPolicyLoader(options?: { handleSignals?: boolean }): PolicyLoader {
  let lastGood: PolicySnapshot | null = null;
  let current: PolicySnapshot | null = null;

  const load = (): PolicySnapshot => {
    try {
      const snapshot = loadPolicyFromDisk();
      lastGood = snapshot;
      current = snapshot;
      return snapshot;
    } catch (error) {
      if (lastGood) {
        current = lastGood;
        return lastGood;
      }
      const policyPath = resolvePolicyPath();
      const fallbackInfo = buildInfo(policyPath, "unavailable", "v1", new Date());
      const fallback: PolicySnapshot = {
        policy: null,
        info: fallbackInfo,
        source: "fallback"
      };
      current = fallback;
      return fallback;
    }
  };

  load();

  if (options?.handleSignals ?? true) {
    process.on("SIGHUP", () => {
      load();
    });
  }

  return {
    getSnapshot: () => current ?? load(),
    reload: () => load()
  };
}

export const policyLoader = createPolicyLoader();
