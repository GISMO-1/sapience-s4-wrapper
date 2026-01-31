# System Trust Report

## Overview
The System Trust Report is a read-only snapshot that summarizes the current active policy state into a single, deterministic view. It synthesizes existing policy governance signals (drift, determinism verification, decision history, rollback posture, and counterfactual data) without introducing any new decision logic.

## How to read the score
The **overall trust score** is a deterministic weighted composite (0–100) derived from the latest available signals:

- **Health (30%)** — Based on the drift health state.
- **Determinism (25%)** — Whether the policy state is reproducible from the event log.
- **Drift (20%)** — Recent quality score from drift metrics.
- **Confidence (15%)** — Latest decision confidence score.
- **Rollback stability (10%)** — Whether the most recent rollback aligns with the active policy.

Higher scores indicate more stable, reproducible policy governance.

## What it does NOT mean
- It is **not** an approval or safety guarantee.
- It does **not** infer intent risk beyond the existing policy data.
- It does **not** replace audits, human review, or guardrail checks.

## Why it’s deterministic
The report only draws from stored policy records and uses stable ordering and rounding rules. It also uses a deterministic timestamp based on the most recent recorded policy events, ensuring that the same stored state yields the exact same report output.
