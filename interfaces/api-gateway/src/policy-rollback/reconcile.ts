import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import type { PolicyDocument, PolicyConstraint, PolicyRule, PolicyDefaults } from "../policy-code/types";
import type { PolicyEvaluator } from "../policy-code/evaluator";
import type { PolicyLifecycleStore } from "../policy-lifecycle/store";
import type { PolicyLineageStore } from "../policy-lineage/store";
import type { PolicyRollbackStore } from "./store";
import { canonicalJson, sha256 } from "../policy-events/hash";
import { normalizePolicyYaml } from "../policy-packs/hash";
import type { PolicyPackRegistry } from "../policy-packs/registry";
import type {
  ReconcileReport,
  RuleModified,
  RuleSnapshot,
  RuleModificationDelta,
  ReconcileSummary
} from "./types";

const RATE_DECIMALS = 4;
const APPROVAL_TAG_MAP: Record<string, string> = {
  finance: "FINANCE_REVIEWER",
  compliance: "COMPLIANCE_REVIEWER",
  ops: "OPS_REVIEWER",
  safety: "SAFETY_REVIEWER",
  defaults: "POLICY_REVIEWER",
  dev: "DEV_REVIEWER",
  simulation: "SIMULATION_REVIEWER"
};
const AUTO_EXECUTION_ROLE = "AUTO_EXECUTION_REVIEWER";

function roundNumber(value: number): number {
  if (!Number.isFinite(value)) {
    return value;
  }
  return Number(value.toFixed(RATE_DECIMALS));
}

function sortStrings<T extends string>(values: T[]): T[] {
  return values.slice().sort((a, b) => a.localeCompare(b)) as T[];
}

function hashPolicySource(raw: string): string {
  return createHash("sha256").update(raw).digest("hex");
}

function normalizeDefaults(defaults: PolicyDefaults): PolicyDefaults {
  return {
    confidenceThreshold: roundNumber(defaults.confidenceThreshold),
    execution: {
      autoRequires: sortStrings(defaults.execution.autoRequires)
    }
  };
}

function normalizeConstraint(constraint: PolicyConstraint): PolicyConstraint {
  switch (constraint.type) {
    case "CONFIDENCE_MIN":
      return {
        type: "CONFIDENCE_MIN",
        params: { min: roundNumber(constraint.params.min) }
      };
    case "MAX_AMOUNT":
      return {
        type: "MAX_AMOUNT",
        params: { max: roundNumber(constraint.params.max) }
      };
    case "SKU_BLOCKLIST":
      return {
        type: "SKU_BLOCKLIST",
        params: { skus: sortStrings(constraint.params.skus) }
      };
    case "VENDOR_BLOCKLIST":
      return {
        type: "VENDOR_BLOCKLIST",
        params: { vendors: sortStrings(constraint.params.vendors) }
      };
    case "EXECUTION_MODE":
      return {
        type: "EXECUTION_MODE",
        params: { mode: constraint.params.mode }
      };
    case "RATE_LIMIT":
      return {
        type: "RATE_LIMIT",
        params: {
          windowSeconds: roundNumber(constraint.params.windowSeconds),
          max: roundNumber(constraint.params.max)
        }
      };
    default:
      return constraint;
  }
}

function normalizeRule(rule: PolicyRule): PolicyRule {
  const normalizedConstraints = rule.constraints
    .map((constraint) => normalizeConstraint(constraint))
    .slice()
    .sort((a, b) => {
      if (a.type !== b.type) {
        return a.type.localeCompare(b.type);
      }
      return canonicalJson(a).localeCompare(canonicalJson(b));
    });

  return {
    ...rule,
    priority: roundNumber(rule.priority),
    appliesTo: {
      intentTypes: sortStrings(rule.appliesTo.intentTypes)
    },
    constraints: normalizedConstraints,
    tags: sortStrings(rule.tags)
  };
}

function normalizePolicy(policy: PolicyDocument): PolicyDocument {
  return {
    version: policy.version,
    defaults: normalizeDefaults(policy.defaults),
    rules: policy.rules
      .map((rule) => normalizeRule(rule))
      .sort((a, b) => a.id.localeCompare(b.id))
  };
}

function deriveRuleApprovals(rule: PolicyRule): string[] {
  if (!rule.enabled || rule.decision !== "WARN") {
    return [];
  }
  const roles = rule.tags
    .map((tag) => APPROVAL_TAG_MAP[tag])
    .filter((value): value is string => Boolean(value));
  return sortStrings(Array.from(new Set(roles)));
}

function deriveAutoExecutionApprovals(defaults: PolicyDefaults): string[] {
  const autoRequires = defaults.execution.autoRequires;
  if (autoRequires.includes("WARN") || autoRequires.includes("ALLOW_ONLY")) {
    return [AUTO_EXECUTION_ROLE];
  }
  return [];
}

function buildRuleSnapshot(rule: PolicyRule): RuleSnapshot {
  return {
    ruleId: rule.id,
    rule,
    approvalRoles: deriveRuleApprovals(rule)
  };
}

function diffStringLists(before: string[], after: string[]): { added: string[]; removed: string[] } {
  const beforeSet = new Set(before);
  const afterSet = new Set(after);
  const added = sortStrings(after.filter((value) => !beforeSet.has(value)));
  const removed = sortStrings(before.filter((value) => !afterSet.has(value)));
  return { added, removed };
}

function diffConstraints(before: PolicyConstraint[], after: PolicyConstraint[]) {
  const toKey = (constraint: PolicyConstraint) => canonicalJson(constraint);
  const beforeKeys = new Map(before.map((constraint) => [toKey(constraint), constraint]));
  const afterKeys = new Map(after.map((constraint) => [toKey(constraint), constraint]));

  const added = Array.from(afterKeys.entries())
    .filter(([key]) => !beforeKeys.has(key))
    .map(([, constraint]) => constraint)
    .sort((a, b) => canonicalJson(a).localeCompare(canonicalJson(b)));

  const removed = Array.from(beforeKeys.entries())
    .filter(([key]) => !afterKeys.has(key))
    .map(([, constraint]) => constraint)
    .sort((a, b) => canonicalJson(a).localeCompare(canonicalJson(b)));

  return { added, removed };
}

function buildRuleDelta(before: RuleSnapshot, after: RuleSnapshot): RuleModificationDelta {
  const tagDiff = diffStringLists(before.rule.tags, after.rule.tags);
  const intentDiff = diffStringLists(before.rule.appliesTo.intentTypes, after.rule.appliesTo.intentTypes);
  const constraintDiff = diffConstraints(before.rule.constraints, after.rule.constraints);
  const approvalsDiff = diffStringLists(before.approvalRoles, after.approvalRoles);

  return {
    enabledChanged: before.rule.enabled !== after.rule.enabled,
    decisionChanged: before.rule.decision !== after.rule.decision,
    priorityDelta: roundNumber(after.rule.priority - before.rule.priority),
    tagsAdded: tagDiff.added,
    tagsRemoved: tagDiff.removed,
    intentTypesAdded: intentDiff.added,
    intentTypesRemoved: intentDiff.removed,
    constraintsAdded: constraintDiff.added,
    constraintsRemoved: constraintDiff.removed,
    approvalsAdded: approvalsDiff.added,
    approvalsRemoved: approvalsDiff.removed
  };
}

function collectPolicyApprovals(policy: PolicyDocument): string[] {
  const roles = new Set<string>();
  policy.rules.forEach((rule) => {
    deriveRuleApprovals(rule).forEach((role) => roles.add(role));
  });
  deriveAutoExecutionApprovals(policy.defaults).forEach((role) => roles.add(role));
  return sortStrings(Array.from(roles));
}

function buildSummary(input: {
  from: PolicyDocument;
  to: PolicyDocument;
  addedCount: number;
  removedCount: number;
  modifiedCount: number;
}): ReconcileSummary {
  const { from, to } = input;
  const fromApprovals = collectPolicyApprovals(from);
  const toApprovals = collectPolicyApprovals(to);
  const approvalsDiff = diffStringLists(fromApprovals, toApprovals);
  const defaultsChanged = canonicalJson(normalizeDefaults(from.defaults)) !== canonicalJson(normalizeDefaults(to.defaults));
  const autoExecutionApprovalsChanged =
    canonicalJson(deriveAutoExecutionApprovals(from.defaults)) !== canonicalJson(deriveAutoExecutionApprovals(to.defaults));

  return {
    rulesAdded: input.addedCount,
    rulesRemoved: input.removedCount,
    rulesModified: input.modifiedCount,
    approvalsAdded: approvalsDiff.added,
    approvalsRemoved: approvalsDiff.removed,
    defaultsChanged,
    autoExecutionApprovalsChanged
  };
}

export function buildReconcileReport(input: {
  fromPolicyHash: string;
  toPolicyHash: string;
  fromPolicy: PolicyDocument;
  toPolicy: PolicyDocument;
}): ReconcileReport {
  const fromPolicy = normalizePolicy(input.fromPolicy);
  const toPolicy = normalizePolicy(input.toPolicy);

  const fromRules = new Map(fromPolicy.rules.map((rule) => [rule.id, buildRuleSnapshot(rule)]));
  const toRules = new Map(toPolicy.rules.map((rule) => [rule.id, buildRuleSnapshot(rule)]));

  const rulesAdded: RuleSnapshot[] = [];
  const rulesRemoved: RuleSnapshot[] = [];
  const rulesModified: RuleModified[] = [];

  toRules.forEach((snapshot, ruleId) => {
    if (!fromRules.has(ruleId)) {
      rulesAdded.push(snapshot);
    }
  });

  fromRules.forEach((snapshot, ruleId) => {
    if (!toRules.has(ruleId)) {
      rulesRemoved.push(snapshot);
    }
  });

  fromRules.forEach((before, ruleId) => {
    const after = toRules.get(ruleId);
    if (!after) {
      return;
    }
    if (canonicalJson(before.rule) === canonicalJson(after.rule)) {
      return;
    }
    rulesModified.push({
      ruleId,
      before,
      after,
      changes: buildRuleDelta(before, after)
    });
  });

  const sortedAdded = rulesAdded.sort((a, b) => a.ruleId.localeCompare(b.ruleId));
  const sortedRemoved = rulesRemoved.sort((a, b) => a.ruleId.localeCompare(b.ruleId));
  const sortedModified = rulesModified.sort((a, b) => a.ruleId.localeCompare(b.ruleId));

  const summary = buildSummary({
    from: fromPolicy,
    to: toPolicy,
    addedCount: sortedAdded.length,
    removedCount: sortedRemoved.length,
    modifiedCount: sortedModified.length
  });

  const reportBase = {
    fromPolicyHash: input.fromPolicyHash,
    toPolicyHash: input.toPolicyHash,
    summary,
    rulesAdded: sortedAdded,
    rulesRemoved: sortedRemoved,
    rulesModified: sortedModified
  } satisfies Omit<ReconcileReport, "reportHash">;

  const reportHash = sha256(canonicalJson(reportBase));

  return {
    ...reportBase,
    reportHash
  };
}

export async function resolvePolicyDocumentByHash(input: {
  policyHash: string;
  lifecycleStore: PolicyLifecycleStore;
  evaluator: PolicyEvaluator;
  policyPackRegistry: PolicyPackRegistry;
}): Promise<PolicyDocument> {
  const snapshot = input.evaluator.getPolicySnapshot();
  if (snapshot.policy && snapshot.info.hash === input.policyHash) {
    return normalizePolicy(snapshot.policy);
  }

  const status = input.lifecycleStore.getStatus(input.policyHash);
  if (status?.inlineYaml) {
    const raw = status.inlineYaml;
    if (hashPolicySource(raw) === input.policyHash) {
      const { policy } = normalizePolicyYaml(raw);
      return normalizePolicy(policy);
    }
  }

  if (status?.ref) {
    const raw = readFileSync(status.ref, "utf-8");
    if (hashPolicySource(raw) === input.policyHash) {
      const { policy } = normalizePolicyYaml(raw);
      return normalizePolicy(policy);
    }
  }

  const packs = input.policyPackRegistry.listPacks();
  for (const pack of packs) {
    const packPath = input.policyPackRegistry.getPackPath(pack.name);
    const raw = readFileSync(`${packPath}/policy.yaml`, "utf-8");
    if (hashPolicySource(raw) === input.policyHash) {
      const { policy } = normalizePolicyYaml(raw);
      return normalizePolicy(policy);
    }
  }

  throw new Error("Policy hash could not be resolved to a stored policy document.");
}

type TimelineEvent = {
  timestamp: string;
  type: "promotion" | "rollback";
  toPolicyHash: string;
  fromPolicyHash: string | null;
};

function eventOrder(type: TimelineEvent["type"]): number {
  return type === "promotion" ? 1 : 2;
}

function sortTimelineEvents(events: TimelineEvent[]): TimelineEvent[] {
  return events.slice().sort((a, b) => {
    if (a.timestamp !== b.timestamp) {
      return a.timestamp.localeCompare(b.timestamp);
    }
    const orderDiff = eventOrder(a.type) - eventOrder(b.type);
    if (orderDiff !== 0) {
      return orderDiff;
    }
    if (a.toPolicyHash !== b.toPolicyHash) {
      return a.toPolicyHash.localeCompare(b.toPolicyHash);
    }
    return (a.fromPolicyHash ?? "").localeCompare(b.fromPolicyHash ?? "");
  });
}

function selectBasePolicyHash(events: TimelineEvent[], fallback: string): string {
  const promotionWithNullParent = events.find((event) => event.type === "promotion" && !event.fromPolicyHash);
  if (promotionWithNullParent) {
    return promotionWithNullParent.toPolicyHash;
  }
  const firstPromotion = events.find((event) => event.type === "promotion");
  if (firstPromotion) {
    return firstPromotion.toPolicyHash;
  }
  return fallback;
}

function resolvePolicyAt(events: TimelineEvent[], time: Date, fallback: string): string {
  const sorted = sortTimelineEvents(events);
  let active = selectBasePolicyHash(sorted, fallback);
  const cutoff = time.getTime();
  for (const event of sorted) {
    const eventTime = new Date(event.timestamp).getTime();
    if (Number.isNaN(eventTime)) {
      continue;
    }
    if (eventTime > cutoff) {
      break;
    }
    active = event.toPolicyHash;
  }
  return active;
}

export async function resolvePolicyHashesForWindow(input: {
  since: Date;
  until: Date;
  activePolicyHash: string;
  lineageStore: PolicyLineageStore;
  rollbackStore: PolicyRollbackStore;
}): Promise<{ fromPolicyHash: string; toPolicyHash: string }> {
  const [lineages, rollbacks] = await Promise.all([
    input.lineageStore.listLineages(),
    input.rollbackStore.listRollbacks()
  ]);

  const events: TimelineEvent[] = [];
  lineages.forEach((lineage) => {
    events.push({
      timestamp: lineage.promotedAt,
      type: "promotion",
      toPolicyHash: lineage.policyHash,
      fromPolicyHash: lineage.parentPolicyHash
    });
  });

  rollbacks.forEach((event) => {
    events.push({
      timestamp: event.createdAt,
      type: "rollback",
      toPolicyHash: event.toPolicyHash,
      fromPolicyHash: event.fromPolicyHash
    });
  });

  if (!events.length) {
    return { fromPolicyHash: input.activePolicyHash, toPolicyHash: input.activePolicyHash };
  }

  const fromPolicyHash = resolvePolicyAt(events, input.since, input.activePolicyHash);
  const toPolicyHash = resolvePolicyAt(events, input.until, input.activePolicyHash);

  return { fromPolicyHash, toPolicyHash };
}
