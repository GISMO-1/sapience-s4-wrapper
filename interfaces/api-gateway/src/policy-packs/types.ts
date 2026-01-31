import type { PolicyDocument } from "../policy-code/types";
import type { DriftReport } from "../policy-drift/types";
import type { PolicyImpactReport } from "../policy-impact/types";
import type { GuardrailDecision } from "../policy-promotion-guardrails/types";

export type PolicyPackMetadata = {
  name: string;
  version: string;
  description: string;
  createdAt: string;
  author: string;
};

export type PolicyPackSignature = {
  algorithm: "HMAC-SHA256";
  signature: string;
};

export type PolicyPackSummary = {
  name: string;
  version: string;
  description: string;
  createdAt: string;
  author: string;
  policyHash: string;
  packHash: string;
  signed: boolean;
};

export type PolicyPackDetails = PolicyPackSummary & {
  policy: PolicyDocument;
  notes?: string;
  signatureFile?: Record<string, unknown> | null;
  signature?: PolicyPackSignature | null;
};

export type PolicyPackDownload = {
  metadata: PolicyPackMetadata;
  policy: PolicyDocument;
  notes?: string;
  hashes: {
    policyHash: string;
    packHash: string;
  };
  signature?: PolicyPackSignature | null;
  signed: boolean;
};

export type PolicyPackInstallBundle = {
  pack: PolicyPackSummary;
  candidate: {
    policyHash: string;
    source: "path";
    ref: string;
  };
  hashes: {
    policyHash: string;
    packHash: string;
    candidatePolicyHash: string;
  };
  reports: {
    impact: PolicyImpactReport;
    drift: DriftReport;
    guardrail: GuardrailDecision;
  };
};
