import { createHash, createHmac } from "node:crypto";
import { parse as parseYaml } from "yaml";
import { policyDocumentSchema } from "../policy-code/schema";
import type { PolicyDocument } from "../policy-code/types";
import type { PolicyPackMetadata, PolicyPackSignature } from "./types";

function stableStringify(value: unknown): string {
  if (value === null) {
    return "null";
  }
  if (typeof value === "number" || typeof value === "boolean") {
    return JSON.stringify(value);
  }
  if (typeof value === "string") {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map((entry) => stableStringify(entry)).join(",")}]`;
  }
  if (typeof value === "object") {
    const record = value as Record<string, unknown>;
    const keys = Object.keys(record).filter((key) => record[key] !== undefined).sort((a, b) => a.localeCompare(b));
    const entries = keys.map((key) => `${JSON.stringify(key)}:${stableStringify(record[key])}`);
    return `{${entries.join(",")}}`;
  }
  return "null";
}

function hashString(input: string): string {
  return createHash("sha256").update(input).digest("hex");
}

export function normalizePolicyYaml(raw: string): { policy: PolicyDocument; normalizedJson: string } {
  const parsed = parseYaml(raw);
  const policy = policyDocumentSchema.parse(parsed);
  const normalizedJson = stableStringify(policy);
  return { policy, normalizedJson };
}

export function buildPolicyHash(raw: string): { policy: PolicyDocument; policyHash: string; normalizedJson: string } {
  const { policy, normalizedJson } = normalizePolicyYaml(raw);
  return {
    policy,
    normalizedJson,
    policyHash: hashString(normalizedJson)
  };
}

export function buildPackHash(input: {
  metadata: PolicyPackMetadata;
  policy: PolicyDocument;
  notes?: string;
}): string {
  const payload = {
    metadata: input.metadata,
    policy: input.policy,
    notes: input.notes ?? null
  };
  return hashString(stableStringify(payload));
}

export function buildPackSignature(packHash: string, signingKey?: string): PolicyPackSignature | null {
  if (!signingKey) {
    return null;
  }
  const signature = createHmac("sha256", signingKey).update(packHash).digest("hex");
  return { algorithm: "HMAC-SHA256", signature };
}

export { stableStringify };
