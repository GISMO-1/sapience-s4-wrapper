# Decision Rationale + Risk Ledger

## Overview
The decision rationale layer captures **why a decision happened**, **what risk was accepted**, **who approved it**, **which alternatives were rejected**, and **how confident the system was**. Each entry is deterministic, queryable, and human-readable, with a stable decision ID derived from canonical inputs.

This ledger applies to:
- **Executions** (policy evaluations for intents)
- **Promotions** (candidate policies moving to active)
- **Rollbacks** (returning to a prior policy)
- **Counterfactuals** (what would have happened under a different policy)

## Decision vs. Outcome vs. Event
- **Decision**: The canonical conclusion (ALLOW / WARN / DENY / FAIL) paired with rationale blocks and a confidence score.
- **Outcome**: The real-world result captured in outcomes (success / failure / override / rollback).
- **Event**: Lifecycle or provenance activities (approvals, guardrail checks, promotions, rollbacks).

Decisions are immutable and referenced by a stable `decisionId`. Outcomes and events can accumulate over time and link back to decisions where available.

## Confidence Semantics
Confidence is a deterministic weighted score in the range **0.0–1.0**. It is computed from:
1. **Rule coverage**: How much of the policy’s rule set was exercised.
2. **Variance**: Stability from quality or risk signals.
3. **Counterfactual delta**: The magnitude of changes expected under alternative policies.

Scores are rounded to four decimal places to ensure stable hashing and golden regression alignment.

## Risk Acceptance Model
Each decision includes an accepted risk ledger entry:
- **Severity**: LOW / MEDIUM / HIGH
- **Justification**: Human-readable rationale (review notes, guardrail rationale, or risk signals)
- **Reviewer** (optional): Human approver who accepted risk
- **Score** (optional): Numeric risk score when supplied by promotion or approval flows

This field is always present, even if it defaults to low severity and a system-generated justification.

## How Auditors Should Read It
1. Start with the **decision type** and **outcome**.
2. Review **rationale blocks** in order:
   - Rule evaluations
   - Guardrail checks
   - Thresholds crossed
   - Human overrides (if any)
3. Confirm the **accepted risk** entry and reviewer (if any).
4. Inspect **rejected alternatives** to understand counterfactual impact.
5. Follow `decisionId` links from lifecycle timelines or provenance reports to retrieve full rationale details.
