import { z } from "zod";
import type { Intent } from "../intent/intent-model";
import { intentTypeSchema } from "../intent/intent-model";

export type PolicyDecision = "ALLOW" | "WARN" | "DENY";
export type ExecutionMode = "manual" | "auto" | "simulate";
export type AutoRequirement = "WARN" | "ALLOW_ONLY";
export type IntentType = z.infer<typeof intentTypeSchema>;

export type PolicyDefaults = {
  confidenceThreshold: number;
  execution: {
    autoRequires: AutoRequirement[];
  };
};

export type PolicyConstraint =
  | {
      type: "CONFIDENCE_MIN";
      params: { min: number };
    }
  | {
      type: "MAX_AMOUNT";
      params: { max: number };
    }
  | {
      type: "SKU_BLOCKLIST";
      params: { skus: string[] };
    }
  | {
      type: "VENDOR_BLOCKLIST";
      params: { vendors: string[] };
    }
  | {
      type: "EXECUTION_MODE";
      params: { mode: ExecutionMode };
    }
  | {
      type: "RATE_LIMIT";
      params: { windowSeconds: number; max: number };
    };

export type PolicyRule = {
  id: string;
  enabled: boolean;
  priority: number;
  appliesTo: {
    intentTypes: IntentType[];
  };
  constraints: PolicyConstraint[];
  decision: PolicyDecision;
  reason: string;
  tags: string[];
};

export type PolicyDocument = {
  version: "v1";
  defaults: PolicyDefaults;
  rules: PolicyRule[];
};

export type PolicyInfo = {
  version: string;
  hash: string;
  loadedAt: string;
  path: string;
};

export type RiskSignal = {
  key: string;
  value: string | number | boolean | null;
  note: string;
};

export type RiskAssessment = {
  level: "low" | "medium" | "high";
  signals: RiskSignal[];
};

export type PolicyMatch = {
  ruleId: string;
  decision: PolicyDecision;
  reason: string;
  tags: string[];
  priority?: number;
  constraintTypes: PolicyConstraint["type"][];
};

export type PolicyReason = {
  ruleId: string;
  decision: PolicyDecision;
  reason: string;
};

export type PolicyDecisionResult = {
  final: PolicyDecision;
  matchedRules: PolicyMatch[];
  reasons: PolicyReason[];
  categories: string[];
  risk: RiskAssessment;
  executionMode: ExecutionMode;
  policy: PolicyInfo;
  simulationAllowed: boolean;
};

export type PolicyEvaluationContext = {
  executionMode: ExecutionMode;
  traceId: string;
};

export type PolicyEvaluationInput = {
  intent: Intent;
  context: PolicyEvaluationContext;
};
