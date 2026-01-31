import { expect, test } from "vitest";
import { buildPackHash, buildPolicyHash, stableStringify } from "../src/policy-packs/hash";
import type { PolicyPackMetadata } from "../src/policy-packs/types";

const samplePolicyA = `version: "v1"
defaults:
  confidenceThreshold: 0.5
  execution:
    autoRequires: ["WARN"]
rules:
  - id: "rule-1"
    enabled: true
    priority: 1
    appliesTo:
      intentTypes: ["CREATE_PO"]
    constraints: []
    decision: "ALLOW"
    reason: "Allow standard POs."
    tags: ["baseline"]
`;

const samplePolicyB = `version: "v1"
rules:
  - id: "rule-1"
    decision: "ALLOW"
    reason: "Allow standard POs."
    constraints: []
    appliesTo:
      intentTypes: ["CREATE_PO"]
    priority: 1
    enabled: true
    tags: ["baseline"]
defaults:
  execution:
    autoRequires: ["WARN"]
  confidenceThreshold: 0.5
`;

test("policy hash is stable across YAML ordering", () => {
  const hashA = buildPolicyHash(samplePolicyA);
  const hashB = buildPolicyHash(samplePolicyB);
  expect(hashA.policyHash).toEqual(hashB.policyHash);
  expect(hashA.normalizedJson).toEqual(hashB.normalizedJson);
});

test("pack hash is stable across object ordering", () => {
  const metadata: PolicyPackMetadata = {
    name: "sample-pack",
    version: "1.0.0",
    description: "Sample pack",
    createdAt: "2024-04-01T00:00:00Z",
    author: "Sapience"
  };
  const metadataAlt: PolicyPackMetadata = {
    author: "Sapience",
    createdAt: "2024-04-01T00:00:00Z",
    description: "Sample pack",
    version: "1.0.0",
    name: "sample-pack"
  };
  const { policy } = buildPolicyHash(samplePolicyA);
  const packHash = buildPackHash({ metadata, policy, notes: "Notes" });
  const reorderedHash = buildPackHash({ metadata: metadataAlt, policy, notes: "Notes" });
  expect(packHash).toEqual(reorderedHash);
  expect(stableStringify({ policy, metadata: metadataAlt, notes: "Notes" })).toContain("\"metadata\"");
});
