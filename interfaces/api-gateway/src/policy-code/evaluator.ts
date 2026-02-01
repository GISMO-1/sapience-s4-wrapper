import type { Intent } from "../intent/intent-model";
import { policyLoader, type PolicySnapshot } from "./loader";
import type {
  PolicyDecision,
  PolicyDecisionResult,
  PolicyEvaluationContext,
  PolicyMatch,
  PolicyReason,
  RiskAssessment
} from "./types";
import { deriveRequiredApprovals } from "./approvals";
import { nowMs } from "../testing/determinism";

export type RateLimiter = {
  isLimited: (key: string, windowSeconds: number, max: number) => boolean;
};

export class InMemoryRateLimiter implements RateLimiter {
  private readonly entries = new Map<string, number[]>();

  constructor(private readonly now: () => number = () => nowMs()) {}

  isLimited(key: string, windowSeconds: number, max: number): boolean {
    const windowMs = windowSeconds * 1000;
    const cutoff = this.now() - windowMs;
    const existing = this.entries.get(key) ?? [];
    const filtered = existing.filter((timestamp) => timestamp > cutoff);
    if (filtered.length >= max) {
      this.entries.set(key, filtered);
      return true;
    }
    filtered.push(this.now());
    this.entries.set(key, filtered);
    return false;
  }
}

export type PolicyEvaluator = {
  evaluate: (intent: Intent, context: PolicyEvaluationContext) => PolicyDecisionResult;
  getPolicySnapshot: () => PolicySnapshot;
  reloadPolicy: () => PolicySnapshot;
};

export function computeRisk(intent: Intent): RiskAssessment {
  const signals: RiskAssessment["signals"] = [];
  let level: RiskAssessment["level"] = "low";

  if (intent.intentType === "CREATE_PO") {
    const quantity = intent.entities.quantity;
    if (typeof quantity === "number") {
      if (quantity > 1000) {
        level = quantity > 5000 ? "high" : "medium";
        signals.push({
          key: "quantity",
          value: quantity,
          note: quantity > 5000
            ? "CREATE_PO quantity exceeds 5000 units."
            : "CREATE_PO quantity exceeds 1000 units."
        });
      }
    }

    if (!intent.entities.vendor) {
      signals.push({
        key: "vendor",
        value: null,
        note: "Vendor missing for CREATE_PO intent."
      });
    }
  }

  return { level, signals };
}

function resolveDecision(matches: PolicyMatch[]): PolicyDecision {
  if (matches.some((match) => match.decision === "DENY")) {
    return "DENY";
  }
  if (matches.some((match) => match.decision === "WARN")) {
    return "WARN";
  }
  return "ALLOW";
}

function buildFallbackDecision(context: PolicyEvaluationContext, snapshot: PolicySnapshot, risk: RiskAssessment): PolicyDecisionResult {
  const decision: PolicyDecision = context.executionMode === "auto" ? "DENY" : "WARN";
  const match: PolicyMatch = {
    ruleId: "__no_policy_loaded",
    decision,
    reason: "No policy file loaded; applying safe fallback behavior.",
    tags: ["defaults"],
    constraintTypes: []
  };
  const requiredApprovals = deriveRequiredApprovals({
    matchedRules: [match],
    executionMode: context.executionMode,
    defaults: snapshot.policy?.defaults,
    finalDecision: decision
  });
  return {
    final: decision,
    matchedRules: [match],
    reasons: [
      {
        ruleId: match.ruleId,
        decision,
        reason: match.reason
      }
    ],
    categories: ["defaults"],
    risk,
    executionMode: context.executionMode,
    policy: snapshot.info,
    simulationAllowed: context.executionMode === "simulate",
    requiredApprovals
  };
}

export function createPolicyEvaluator(options?: {
  limiter?: RateLimiter;
  loader?: typeof policyLoader;
  now?: () => number;
}): PolicyEvaluator {
  const limiter = options?.limiter ?? new InMemoryRateLimiter(options?.now ?? (() => nowMs()));
  const loader = options?.loader ?? policyLoader;

  const evaluate = (intent: Intent, context: PolicyEvaluationContext): PolicyDecisionResult => {
    const snapshot = loader.getSnapshot();
    const risk = computeRisk(intent);

    if (!snapshot.policy) {
      return buildFallbackDecision(context, snapshot, risk);
    }

    const policy = snapshot.policy;
    const matchedRules: PolicyMatch[] = [];
    const reasons: PolicyReason[] = [];
    const categories = new Set<string>();

    const addMatch = (match: PolicyMatch): void => {
      matchedRules.push(match);
      reasons.push({ ruleId: match.ruleId, decision: match.decision, reason: match.reason });
      match.tags.forEach((tag) => categories.add(tag));
    };

    if (intent.confidence < policy.defaults.confidenceThreshold) {
      addMatch({
        ruleId: "__default_confidence_threshold",
        decision: "DENY",
        reason: "Intent confidence below policy threshold.",
        tags: ["defaults"],
        constraintTypes: ["CONFIDENCE_MIN"]
      });
    }

    if (context.executionMode === "auto" && risk.level === "high") {
      const decision: PolicyDecision = policy.defaults.execution.autoRequires.includes("ALLOW_ONLY")
        ? "DENY"
        : "WARN";
      addMatch({
        ruleId: "__default_auto_high_risk",
        decision,
        reason: "High-risk intent flagged for auto execution.",
        tags: ["defaults"],
        constraintTypes: ["EXECUTION_MODE"]
      });
    }

    const orderedRules = policy.rules
      .filter((rule) => rule.enabled)
      .slice()
      .sort((a, b) => {
        if (b.priority !== a.priority) {
          return b.priority - a.priority;
        }
        return a.id.localeCompare(b.id);
      });

    for (const rule of orderedRules) {
      if (!rule.appliesTo.intentTypes.includes(intent.intentType)) {
        continue;
      }
      const constraintsMatch = rule.constraints.every((constraint) => {
        switch (constraint.type) {
          case "CONFIDENCE_MIN":
            return intent.confidence < constraint.params.min;
          case "MAX_AMOUNT": {
            const amount = intent.entities.amount;
            return typeof amount === "number" && amount > constraint.params.max;
          }
          case "SKU_BLOCKLIST":
            return intent.entities.sku ? constraint.params.skus.includes(intent.entities.sku) : false;
          case "VENDOR_BLOCKLIST":
            return intent.entities.vendor ? constraint.params.vendors.includes(intent.entities.vendor) : false;
          case "EXECUTION_MODE":
            return context.executionMode === constraint.params.mode;
          case "RATE_LIMIT": {
            const key = [intent.intentType, intent.entities.sku ?? "", intent.entities.vendor ?? ""]
              .filter(Boolean)
              .join(":");
            return limiter.isLimited(key, constraint.params.windowSeconds, constraint.params.max);
          }
          default:
            return false;
        }
      });

      if (constraintsMatch) {
        addMatch({
          ruleId: rule.id,
          decision: rule.decision,
          reason: rule.reason,
          tags: rule.tags,
          priority: rule.priority,
          constraintTypes: rule.constraints.map((constraint) => constraint.type)
        });
      }
    }

    const finalDecision = resolveDecision(matchedRules);
    const simulationAllowed =
      context.executionMode === "simulate" &&
      matchedRules.some(
        (match) =>
          match.constraintTypes.includes("EXECUTION_MODE") &&
          match.decision !== "DENY"
      );

    const requiredApprovals = deriveRequiredApprovals({
      matchedRules,
      executionMode: context.executionMode,
      defaults: policy.defaults,
      finalDecision
    });

    return {
      final: finalDecision,
      matchedRules,
      reasons,
      categories: Array.from(categories),
      risk,
      executionMode: context.executionMode,
      policy: snapshot.info,
      simulationAllowed,
      requiredApprovals
    };
  };

  return {
    evaluate,
    getPolicySnapshot: () => loader.getSnapshot(),
    reloadPolicy: () => loader.reload()
  };
}
