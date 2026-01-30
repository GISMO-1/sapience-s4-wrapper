import { existsSync, readFileSync } from "node:fs";
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

export type CandidatePolicySource = "current" | "path" | "inline";

export type CandidatePolicyRequest = {
  source: CandidatePolicySource;
  ref?: string;
  yaml?: string;
};

export type CandidatePolicySnapshot = {
  policy: PolicyDocument;
  info: PolicyInfo;
  source: CandidatePolicySource;
  ref?: string;
};

function resolvePolicyRoot(): string {
  const roots = [
    process.cwd(),
    path.resolve(process.cwd(), ".."),
    path.resolve(process.cwd(), "..", ".."),
    path.resolve(process.cwd(), "..", "..", "..")
  ];

  for (const candidate of roots) {
    const policyDir = path.resolve(candidate, "policies");
    if (existsSync(policyDir)) {
      return policyDir;
    }
  }

  return path.resolve(process.cwd(), "policies");
}

const POLICY_ROOT = resolvePolicyRoot();
const DEFAULT_POLICY_PATH = path.resolve(POLICY_ROOT, "policies.v1.yaml");

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

function hashPolicy(raw: string): string {
  return createHash("sha256").update(raw).digest("hex");
}

function parsePolicy(raw: string): PolicyDocument {
  const parsed = parseYaml(raw);
  return policyDocumentSchema.parse(parsed);
}

function resolvePolicyPathUnderRoot(ref: string): string {
  const resolved = path.isAbsolute(ref) ? path.resolve(ref) : path.resolve(POLICY_ROOT, ref);
  const normalizedRoot = path.resolve(POLICY_ROOT);
  if (!resolved.startsWith(`${normalizedRoot}${path.sep}`)) {
    throw new PolicySourceError("Policy path is outside the allowed policies directory.", 403);
  }
  return resolved;
}

function loadPolicyFromDisk(): PolicySnapshot {
  const policyPath = resolvePolicyPath();
  const raw = readFileSync(policyPath, "utf-8");
  const policy = parsePolicy(raw);
  const hash = hashPolicy(raw);
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

export class PolicySourceError extends Error {
  constructor(
    message: string,
    public readonly statusCode: number
  ) {
    super(message);
    this.name = "PolicySourceError";
  }
}

export function loadPolicyFromSource(request: CandidatePolicyRequest, options?: {
  loader?: PolicyLoader;
  inlineEnabled?: boolean;
}): CandidatePolicySnapshot {
  const loader = options?.loader ?? policyLoader;
  const inlineEnabled = options?.inlineEnabled ?? process.env.POLICY_INLINE_ENABLED === "true";
  const loadedAt = new Date();

  if (request.source === "current") {
    const snapshot = loader.getSnapshot();
    if (!snapshot.policy) {
      throw new PolicySourceError("No policy is currently loaded.", 503);
    }
    return {
      policy: snapshot.policy,
      info: buildInfo(snapshot.info.path, snapshot.info.hash, snapshot.info.version, loadedAt),
      source: "current",
      ref: snapshot.info.path
    };
  }

  if (request.source === "inline") {
    if (!inlineEnabled) {
      throw new PolicySourceError("Inline policy loading is disabled.", 403);
    }
    if (!request.yaml) {
      throw new PolicySourceError("Inline policy YAML is required.", 400);
    }
    const policy = parsePolicy(request.yaml);
    const hash = hashPolicy(request.yaml);
    const ref = request.ref ?? "inline";
    return {
      policy,
      info: buildInfo(ref, hash, policy.version, loadedAt),
      source: "inline",
      ref
    };
  }

  if (!request.ref) {
    throw new PolicySourceError("Policy path reference is required.", 400);
  }
  const resolvedPath = resolvePolicyPathUnderRoot(request.ref);
  const raw = readFileSync(resolvedPath, "utf-8");
  const policy = parsePolicy(raw);
  const hash = hashPolicy(raw);
  return {
    policy,
    info: buildInfo(resolvedPath, hash, policy.version, loadedAt),
    source: "path",
    ref: request.ref
  };
}
