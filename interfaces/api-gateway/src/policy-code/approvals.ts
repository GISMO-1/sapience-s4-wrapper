import type { PolicyDecision, PolicyDefaults, PolicyMatch, RequiredApproval } from "./types";
import type { ExecutionMode } from "./types";

const TAG_ROLE_MAP: Record<string, string> = {
  finance: "FINANCE_REVIEWER",
  compliance: "COMPLIANCE_REVIEWER",
  ops: "OPS_REVIEWER",
  safety: "SAFETY_REVIEWER",
  defaults: "POLICY_REVIEWER",
  dev: "DEV_REVIEWER",
  simulation: "SIMULATION_REVIEWER"
};

const AUTO_EXECUTION_ROLE = "AUTO_EXECUTION_REVIEWER";

function addReason(map: Map<string, Set<string>>, role: string, reason: string) {
  if (!map.has(role)) {
    map.set(role, new Set());
  }
  map.get(role)?.add(reason);
}

function finalize(map: Map<string, Set<string>>): RequiredApproval[] {
  return Array.from(map.entries())
    .sort(([roleA], [roleB]) => roleA.localeCompare(roleB))
    .map(([role, reasons]) => {
      const sortedReasons = Array.from(reasons).sort();
      return {
        role,
        reason: sortedReasons.join(" | ")
      };
    });
}

export function deriveRequiredApprovals(input: {
  matchedRules: PolicyMatch[];
  executionMode: ExecutionMode;
  defaults?: PolicyDefaults | null;
  finalDecision: PolicyDecision;
}): RequiredApproval[] {
  const approvals = new Map<string, Set<string>>();

  for (const match of input.matchedRules) {
    if (match.decision !== "WARN") {
      continue;
    }
    for (const tag of match.tags) {
      const role = TAG_ROLE_MAP[tag];
      if (role) {
        addReason(approvals, role, match.reason);
      }
    }
  }

  const autoRequires = input.defaults?.execution.autoRequires ?? [];
  const autoRequiresWarn = autoRequires.includes("WARN") || autoRequires.includes("ALLOW_ONLY");
  if (input.executionMode === "auto" && input.finalDecision === "WARN" && autoRequiresWarn) {
    addReason(approvals, AUTO_EXECUTION_ROLE, "Auto execution policy requires review for WARN decisions.");
  }

  return finalize(approvals);
}
