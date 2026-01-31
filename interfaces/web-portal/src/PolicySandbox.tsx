import { useEffect, useState, type ChangeEvent } from "react";
import {
  fetchReplayReport,
  fetchTraceExplain,
  fetchPolicyLineageCurrent,
  fetchPolicyTimeline,
  fetchPolicyQuality,
  fetchPolicyDrift,
  fetchPolicyVerify,
  recordPolicyOutcome,
  fetchPolicyImpactReport,
  fetchIntentDecision,
  approveIntent,
  executeIntent,
  fetchPromotionCheck,
  promotePolicy,
  rollbackPolicy,
  reconcilePolicy,
  runPolicyReplay,
  type PolicyOutcomeType,
  type PolicyQualityResponse,
  type PolicyDriftResponse,
  type PolicyVerificationResponse,
  type PolicyLineageResponse,
  type PolicyLifecycleTimeline,
  type PolicyImpactSimulationReport,
  type PromotionGuardrailDecision,
  type IntentDecisionResponse,
  type ReplayCandidateSource,
  type ReplayReport,
  type RollbackDecision,
  type RollbackEvent,
  type ReconcileReport
} from "./api";

const DEFAULT_INLINE = "version: \"v1\"\n";

export function PolicySandbox() {
  const [candidateSource, setCandidateSource] = useState<ReplayCandidateSource>("current");
  const [candidatePath, setCandidatePath] = useState("policies.v1.yaml");
  const [inlineYaml, setInlineYaml] = useState(DEFAULT_INLINE);
  const [limit, setLimit] = useState("100");
  const [intentTypes, setIntentTypes] = useState("");
  const [loading, setLoading] = useState(false);
  const [report, setReport] = useState<ReplayReport | null>(null);
  const [traceExplain, setTraceExplain] = useState<string>("");
  const [error, setError] = useState<string>("");
  const [executionTraceId, setExecutionTraceId] = useState("");
  const [executionDecision, setExecutionDecision] = useState<IntentDecisionResponse | null>(null);
  const [executionDecisionLoading, setExecutionDecisionLoading] = useState(false);
  const [executionDecisionError, setExecutionDecisionError] = useState("");
  const [executionApprover, setExecutionApprover] = useState("local-user");
  const [executionRationale, setExecutionRationale] = useState("");
  const [executionApprovals, setExecutionApprovals] = useState<
    Array<{
      requiredRole: string;
      actor: string;
      rationale: string;
      approvedAt: string;
    }>
  >([]);
  const [executionApprovalStatus, setExecutionApprovalStatus] = useState("");
  const [executionApprovalError, setExecutionApprovalError] = useState("");
  const [executionStatus, setExecutionStatus] = useState("");
  const [executionError, setExecutionError] = useState("");
  const [executionMissingApprovals, setExecutionMissingApprovals] = useState<string[]>([]);
  const [approver, setApprover] = useState("");
  const [approvalRationale, setApprovalRationale] = useState("");
  const [acceptedRiskScore, setAcceptedRiskScore] = useState("");
  const [approvalNotes, setApprovalNotes] = useState("");
  const [promotionStatus, setPromotionStatus] = useState<string>("");
  const [promotionError, setPromotionError] = useState<string>("");
  const [promotionLoading, setPromotionLoading] = useState(false);
  const [lineage, setLineage] = useState<PolicyLineageResponse | null>(null);
  const [lineageError, setLineageError] = useState<string>("");
  const [lifecycleTimeline, setLifecycleTimeline] = useState<PolicyLifecycleTimeline | null>(null);
  const [lifecycleError, setLifecycleError] = useState<string>("");
  const [outcomeTraceId, setOutcomeTraceId] = useState("");
  const [outcomeType, setOutcomeType] = useState<PolicyOutcomeType>("success");
  const [outcomeSeverity, setOutcomeSeverity] = useState("1");
  const [outcomeHumanOverride, setOutcomeHumanOverride] = useState(false);
  const [outcomeNotes, setOutcomeNotes] = useState("");
  const [outcomeStatus, setOutcomeStatus] = useState("");
  const [outcomeError, setOutcomeError] = useState("");
  const [policyQuality, setPolicyQuality] = useState<PolicyQualityResponse | null>(null);
  const [policyQualityError, setPolicyQualityError] = useState("");
  const [policyQualityLoading, setPolicyQualityLoading] = useState(false);
  const [policyDrift, setPolicyDrift] = useState<PolicyDriftResponse | null>(null);
  const [policyDriftError, setPolicyDriftError] = useState("");
  const [policyDriftLoading, setPolicyDriftLoading] = useState(false);
  const [verificationPolicyHash, setVerificationPolicyHash] = useState("");
  const [verificationSince, setVerificationSince] = useState("");
  const [verificationUntil, setVerificationUntil] = useState("");
  const [verificationResult, setVerificationResult] = useState<PolicyVerificationResponse | null>(null);
  const [verificationError, setVerificationError] = useState("");
  const [verificationLoading, setVerificationLoading] = useState(false);
  const [impactPolicyYaml, setImpactPolicyYaml] = useState(DEFAULT_INLINE);
  const [impactSince, setImpactSince] = useState(() => {
    const date = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    return date.toISOString().slice(0, 16);
  });
  const [impactUntil, setImpactUntil] = useState(() => new Date().toISOString().slice(0, 16));
  const [impactLimit, setImpactLimit] = useState("100");
  const [impactLoading, setImpactLoading] = useState(false);
  const [impactError, setImpactError] = useState("");
  const [impactReport, setImpactReport] = useState<PolicyImpactSimulationReport | null>(null);
  const [guardrailDecision, setGuardrailDecision] = useState<PromotionGuardrailDecision | null>(null);
  const [guardrailCheckLoading, setGuardrailCheckLoading] = useState(false);
  const [guardrailCheckError, setGuardrailCheckError] = useState("");
  const [guardrailReviewer, setGuardrailReviewer] = useState("");
  const [guardrailRationale, setGuardrailRationale] = useState("");
  const [guardrailAcceptedRisk, setGuardrailAcceptedRisk] = useState("");
  const [guardrailForce, setGuardrailForce] = useState(false);
  const [guardrailPromotionStatus, setGuardrailPromotionStatus] = useState("");
  const [guardrailPromotionError, setGuardrailPromotionError] = useState("");
  const [guardrailPromotionLoading, setGuardrailPromotionLoading] = useState(false);
  const [rollbackTargetHash, setRollbackTargetHash] = useState("");
  const [rollbackActor, setRollbackActor] = useState("local-user");
  const [rollbackRationale, setRollbackRationale] = useState("");
  const [rollbackDecision, setRollbackDecision] = useState<RollbackDecision | null>(null);
  const [rollbackEvent, setRollbackEvent] = useState<RollbackEvent | null>(null);
  const [rollbackStatus, setRollbackStatus] = useState("");
  const [rollbackError, setRollbackError] = useState("");
  const [rollbackLoading, setRollbackLoading] = useState(false);
  const [reconcileFromHash, setReconcileFromHash] = useState("");
  const [reconcileToHash, setReconcileToHash] = useState("");
  const [reconcileSince, setReconcileSince] = useState(() => {
    const date = new Date(Date.now() - 24 * 60 * 60 * 1000);
    return date.toISOString().slice(0, 16);
  });
  const [reconcileUntil, setReconcileUntil] = useState(() => new Date().toISOString().slice(0, 16));
  const [reconcileUseWindow, setReconcileUseWindow] = useState(false);
  const [reconcileReport, setReconcileReport] = useState<ReconcileReport | null>(null);
  const [reconcileError, setReconcileError] = useState("");
  const [reconcileLoading, setReconcileLoading] = useState(false);

  useEffect(() => {
    const loadLineage = async () => {
      setLineageError("");
      try {
        const response = await fetchPolicyLineageCurrent();
        setLineage(response);
      } catch (err) {
        setLineageError((err as Error).message);
      }
    };
    loadLineage();
  }, []);

  useEffect(() => {
    if (lineage?.policyHash && !verificationPolicyHash) {
      setVerificationPolicyHash(lineage.policyHash);
    }
  }, [lineage?.policyHash, verificationPolicyHash]);

  useEffect(() => {
    const rollbackCandidates = lineage?.lineage.filter((record) => record.policyHash !== lineage.policyHash) ?? [];
    if (!rollbackTargetHash && rollbackCandidates.length) {
      setRollbackTargetHash(rollbackCandidates[0].policyHash);
    }
    if (!reconcileFromHash && lineage?.policyHash) {
      setReconcileFromHash(lineage.policyHash);
    }
    if (!reconcileToHash && rollbackCandidates.length) {
      setReconcileToHash(rollbackCandidates[0].policyHash);
    }
  }, [lineage, rollbackTargetHash, reconcileFromHash, reconcileToHash]);

  useEffect(() => {
    if (!lineage?.policyHash) {
      setLifecycleTimeline(null);
      setLifecycleError("");
      return;
    }
    const loadTimeline = async () => {
      setLifecycleError("");
      try {
        const response = await fetchPolicyTimeline(lineage.policyHash);
        setLifecycleTimeline(response);
      } catch (err) {
        setLifecycleError((err as Error).message);
        setLifecycleTimeline(null);
      }
    };
    void loadTimeline();
  }, [lineage?.policyHash]);

  useEffect(() => {
    const loadQuality = async () => {
      if (!lineage?.policyHash) {
        return;
      }
      setPolicyQualityLoading(true);
      setPolicyQualityError("");
      try {
        const response = await fetchPolicyQuality(lineage.policyHash);
        setPolicyQuality(response);
      } catch (err) {
        setPolicyQualityError((err as Error).message);
      } finally {
        setPolicyQualityLoading(false);
      }
    };
    void loadQuality();
  }, [lineage?.policyHash]);

  useEffect(() => {
    const loadDrift = async () => {
      if (!lineage?.policyHash) {
        return;
      }
      setPolicyDriftLoading(true);
      setPolicyDriftError("");
      try {
        const response = await fetchPolicyDrift(lineage.policyHash);
        setPolicyDrift(response);
      } catch (err) {
        setPolicyDriftError((err as Error).message);
      } finally {
        setPolicyDriftLoading(false);
      }
    };
    void loadDrift();
  }, [lineage?.policyHash]);

  useEffect(() => {
    const trimmed = executionTraceId.trim();
    if (!trimmed) {
      setExecutionDecision(null);
      setExecutionDecisionError("");
      setExecutionApprovals([]);
      setExecutionMissingApprovals([]);
      return;
    }
    const loadDecision = async () => {
      setExecutionDecisionLoading(true);
      setExecutionDecisionError("");
      try {
        const response = await fetchIntentDecision(trimmed);
        setExecutionDecision(response);
      } catch (err) {
        setExecutionDecisionError((err as Error).message);
        setExecutionDecision(null);
      } finally {
        setExecutionDecisionLoading(false);
      }
    };
    void loadDecision();
  }, [executionTraceId]);

  const buildFilters = () => {
    const parsedLimit = Number(limit);
    const parsedIntentTypes = intentTypes
      .split(",")
      .map((value) => value.trim())
      .filter(Boolean);

    return {
      limit: Number.isFinite(parsedLimit) && parsedLimit > 0 ? parsedLimit : undefined,
      intentTypes: parsedIntentTypes.length ? parsedIntentTypes : undefined
    };
  };

  const buildCandidate = () => {
    if (candidateSource === "path") {
      return { source: "path" as const, ref: candidatePath.trim() };
    }
    if (candidateSource === "inline") {
      return { source: "inline" as const, yaml: inlineYaml };
    }
    return { source: "current" as const };
  };

  const handleReplay = async () => {
    setLoading(true);
    setError("");
    setReport(null);
    setTraceExplain("");
    setPromotionStatus("");
    setPromotionError("");
    try {
      const response = await runPolicyReplay({ candidatePolicy: buildCandidate(), filters: buildFilters() });
      const runId = response?.run?.runId;
      if (!runId) {
        throw new Error("Replay run did not return a runId");
      }
      const reportResponse = await fetchReplayReport(runId);
      setReport(reportResponse);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  };

  const handleImpactUpload = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) {
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      setImpactPolicyYaml(String(reader.result ?? ""));
    };
    reader.readAsText(file);
  };

  const handleImpactSimulation = async () => {
    setImpactLoading(true);
    setImpactError("");
    setImpactReport(null);
    try {
      if (!impactPolicyYaml.trim()) {
        throw new Error("Candidate policy YAML is required.");
      }
      const since = new Date(impactSince);
      const until = new Date(impactUntil);
      if (!Number.isFinite(since.getTime()) || !Number.isFinite(until.getTime())) {
        throw new Error("Both since and until timestamps are required.");
      }
      const parsedLimit = Number(impactLimit);
      const response = await fetchPolicyImpactReport({
        candidatePolicy: impactPolicyYaml,
        since: since.toISOString(),
        until: until.toISOString(),
        limit: Number.isFinite(parsedLimit) && parsedLimit > 0 ? parsedLimit : undefined
      });
      setImpactReport(response);
    } catch (err) {
      setImpactError((err as Error).message);
    } finally {
      setImpactLoading(false);
    }
  };

  const guardrailCandidateHash =
    report?.run.candidate.hash ?? (candidateSource === "current" ? lineage?.policyHash ?? "" : "");

  const handlePromotionCheck = async () => {
    if (!guardrailCandidateHash) {
      return;
    }
    setGuardrailCheckLoading(true);
    setGuardrailCheckError("");
    setGuardrailDecision(null);
    try {
      const response = await fetchPromotionCheck(guardrailCandidateHash);
      setGuardrailDecision(response);
    } catch (err) {
      setGuardrailCheckError((err as Error).message);
    } finally {
      setGuardrailCheckLoading(false);
    }
  };

  const handleGuardrailPromote = async () => {
    if (!guardrailCandidateHash) {
      return;
    }
    setGuardrailPromotionLoading(true);
    setGuardrailPromotionError("");
    setGuardrailPromotionStatus("");
    try {
      await promotePolicy({
        policyHash: guardrailCandidateHash,
        reviewer: guardrailReviewer.trim(),
        rationale: guardrailRationale.trim() || undefined,
        acceptedRisk: guardrailAcceptedRisk ? Number(guardrailAcceptedRisk) : undefined,
        force: guardrailForce
      });
      setGuardrailPromotionStatus("Policy promoted with guardrail review.");
      try {
        const response = await fetchPolicyLineageCurrent();
        setLineage(response);
      } catch (err) {
        setLineageError((err as Error).message);
      }
    } catch (err) {
      setGuardrailPromotionError((err as Error).message);
    } finally {
      setGuardrailPromotionLoading(false);
    }
  };

  const handleRollback = async (dryRun: boolean) => {
    if (!rollbackTargetHash.trim()) {
      return;
    }
    setRollbackLoading(true);
    setRollbackError("");
    setRollbackStatus("");
    setRollbackDecision(null);
    setRollbackEvent(null);
    try {
      const response = await rollbackPolicy({
        targetPolicyHash: rollbackTargetHash.trim(),
        actor: rollbackActor.trim(),
        rationale: rollbackRationale.trim(),
        dryRun
      });
      const data = response.data;
      if (data && typeof data === "object" && "decision" in data) {
        setRollbackDecision(data.decision as RollbackDecision);
        const event = "event" in data ? (data.event as RollbackEvent | null | undefined) : null;
        setRollbackEvent(event ?? null);
      }
      if (response.ok) {
        setRollbackStatus(dryRun ? "Dry run completed." : "Rollback executed.");
        if (!dryRun) {
          const updated = await fetchPolicyLineageCurrent();
          setLineage(updated);
        }
      } else {
        setRollbackError(
          typeof data === "object" && data && "message" in data ? String(data.message) : "Rollback failed."
        );
      }
    } catch (err) {
      setRollbackError((err as Error).message);
    } finally {
      setRollbackLoading(false);
    }
  };

  const handleReconcile = async () => {
    setReconcileLoading(true);
    setReconcileError("");
    setReconcileReport(null);
    try {
      if (reconcileUseWindow) {
        const since = new Date(reconcileSince);
        const until = new Date(reconcileUntil);
        if (!Number.isFinite(since.getTime()) || !Number.isFinite(until.getTime())) {
          throw new Error("Both since and until timestamps are required.");
        }
        const response = await reconcilePolicy({
          since: since.toISOString(),
          until: until.toISOString()
        });
        setReconcileReport(response.report);
      } else {
        const fromPolicyHash = reconcileFromHash.trim();
        const toPolicyHash = reconcileToHash.trim();
        if (!fromPolicyHash || !toPolicyHash) {
          throw new Error("From/to policy hashes are required.");
        }
        const response = await reconcilePolicy({ fromPolicyHash, toPolicyHash });
        setReconcileReport(response.report);
      }
    } catch (err) {
      setReconcileError((err as Error).message);
    } finally {
      setReconcileLoading(false);
    }
  };

  const handlePromote = async () => {
    if (!report) {
      return;
    }
    setPromotionLoading(true);
    setPromotionError("");
    setPromotionStatus("");
    try {
      await promotePolicy({
        runId: report.run.runId,
        approvedBy: approver.trim(),
        rationale: approvalRationale.trim(),
        acceptedRiskScore: Number(acceptedRiskScore),
        reason: approvalRationale.trim(),
        notes: approvalNotes.trim() || undefined
      });
      setPromotionStatus("Policy promoted successfully.");
      try {
        const response = await fetchPolicyLineageCurrent();
        setLineage(response);
      } catch (err) {
        setLineageError((err as Error).message);
      }
    } catch (err) {
      setPromotionError((err as Error).message);
    } finally {
      setPromotionLoading(false);
    }
  };

  const handleTraceExplain = async (traceId: string) => {
    setExecutionTraceId(traceId);
    try {
      const response = await fetchTraceExplain(traceId);
      setTraceExplain(JSON.stringify(response, null, 2));
    } catch (err) {
      setTraceExplain(JSON.stringify({ error: (err as Error).message }, null, 2));
    }
  };

  const handleOutcomeSubmit = async () => {
    setOutcomeStatus("");
    setOutcomeError("");
    try {
      await recordPolicyOutcome({
        traceId: outcomeTraceId.trim(),
        outcomeType,
        severity: Number(outcomeSeverity),
        humanOverride: outcomeHumanOverride,
        notes: outcomeNotes.trim() || undefined
      });
      setOutcomeStatus("Outcome recorded.");
      setOutcomeTraceId("");
      setOutcomeNotes("");
      if (lineage?.policyHash) {
        try {
          const response = await fetchPolicyQuality(lineage.policyHash);
          setPolicyQuality(response);
        } catch (err) {
          setPolicyQualityError((err as Error).message);
        }
        try {
          const response = await fetchPolicyDrift(lineage.policyHash);
          setPolicyDrift(response);
        } catch (err) {
          setPolicyDriftError((err as Error).message);
        }
      }
    } catch (err) {
      setOutcomeError((err as Error).message);
    }
  };

  const handleVerification = async () => {
    const policyHash = verificationPolicyHash.trim();
    if (!policyHash) {
      setVerificationError("Policy hash is required.");
      return;
    }
    setVerificationLoading(true);
    setVerificationError("");
    setVerificationResult(null);
    try {
      const sinceDate = verificationSince ? new Date(verificationSince) : null;
      const untilDate = verificationUntil ? new Date(verificationUntil) : null;
      if (sinceDate && Number.isNaN(sinceDate.getTime())) {
        throw new Error("Invalid since timestamp.");
      }
      if (untilDate && Number.isNaN(untilDate.getTime())) {
        throw new Error("Invalid until timestamp.");
      }
      const response = await fetchPolicyVerify({
        policyHash,
        since: sinceDate ? sinceDate.toISOString() : undefined,
        until: untilDate ? untilDate.toISOString() : undefined
      });
      setVerificationResult(response);
    } catch (err) {
      setVerificationError((err as Error).message);
    } finally {
      setVerificationLoading(false);
    }
  };

  const handleExecutionApprove = async (role: string) => {
    if (!executionTraceId.trim()) {
      return;
    }
    setExecutionApprovalStatus("");
    setExecutionApprovalError("");
    setExecutionMissingApprovals([]);
    try {
      const response = await approveIntent(executionTraceId.trim(), {
        role,
        actor: executionApprover.trim() || "local-user",
        rationale: executionRationale.trim() || "Approved in policy sandbox."
      });
      setExecutionApprovals(
        response.approvals.map((approval) => ({
          requiredRole: approval.requiredRole,
          actor: approval.actor,
          rationale: approval.rationale,
          approvedAt: approval.approvedAt
        }))
      );
      setExecutionApprovalStatus(`Approval recorded for ${role}.`);
      const refreshed = await fetchIntentDecision(executionTraceId.trim());
      setExecutionDecision(refreshed);
    } catch (err) {
      setExecutionApprovalError((err as Error).message);
    }
  };

  const handleExecution = async () => {
    if (!executionTraceId.trim()) {
      return;
    }
    setExecutionStatus("");
    setExecutionError("");
    setExecutionMissingApprovals([]);
    const response = await executeIntent(executionTraceId.trim(), {
      actor: executionApprover.trim() || undefined,
      rationale: executionRationale.trim() || undefined
    });
    if (response.ok) {
      setExecutionStatus("Execution request accepted.");
      setExecutionApprovals([]);
      try {
        const refreshed = await fetchIntentDecision(executionTraceId.trim());
        setExecutionDecision(refreshed);
      } catch (err) {
        setExecutionDecisionError((err as Error).message);
      }
      return;
    }

    const message =
      typeof response.data?.message === "string"
        ? response.data.message
        : `Execution failed with status ${response.status}.`;
    setExecutionError(message);
    if (response.status === 409 && Array.isArray(response.data?.missingApprovals)) {
      setExecutionMissingApprovals(response.data.missingApprovals);
    }
  };

  const severityValue = Number(outcomeSeverity);
  const severityValid = Number.isFinite(severityValue) && severityValue >= 1 && severityValue <= 5;
  const impactedRows =
    impactReport?.rows.filter((row) => !(row.classifications.length === 1 && row.classifications[0] === "UNCHANGED")) ??
    [];
  const guardrailAcceptedRiskValue = Number(guardrailAcceptedRisk);
  const guardrailAcceptedRiskValid =
    guardrailAcceptedRisk.trim().length > 0 && Number.isFinite(guardrailAcceptedRiskValue);
  const guardrailRationaleValid = guardrailRationale.trim().length >= 10;
  const guardrailRequiresAcceptance = guardrailDecision?.requiredAcceptance ?? false;
  const guardrailNeedsForce = guardrailDecision ? !guardrailDecision.allowed : false;
  const guardrailPromoteDisabled =
    guardrailPromotionLoading ||
    !guardrailDecision ||
    !guardrailReviewer.trim() ||
    !guardrailRationaleValid ||
    (guardrailRequiresAcceptance && !guardrailAcceptedRiskValid) ||
    (guardrailNeedsForce && !guardrailForce);

  const blastRadiusClass = (score: number) => {
    if (score >= 70) {
      return "impact-badge impact-badge-high";
    }
    if (score >= 30) {
      return "impact-badge impact-badge-medium";
    }
    return "impact-badge impact-badge-low";
  };

  const lifecycleBadgeClass = (state: string) => {
    switch (state) {
      case "ACTIVE":
        return "lifecycle-badge lifecycle-badge-active";
      case "SUPERSEDED":
        return "lifecycle-badge lifecycle-badge-superseded";
      case "APPROVED":
        return "lifecycle-badge lifecycle-badge-approved";
      case "GUARDED":
        return "lifecycle-badge lifecycle-badge-guarded";
      case "SIMULATED":
        return "lifecycle-badge lifecycle-badge-simulated";
      case "DRAFT":
      default:
        return "lifecycle-badge lifecycle-badge-draft";
    }
  };

  const lifecycleEventLabel = (type: string) => {
    switch (type) {
      case "simulation":
        return "Simulation";
      case "guardrail_check":
        return "Guardrail check";
      case "approval":
        return "Approval";
      case "promotion":
        return "Promotion";
      case "rollback":
        return "Rollback";
      default:
        return type;
    }
  };

  const rollbackCandidates = lineage?.lineage.filter((record) => record.policyHash !== lineage.policyHash) ?? [];
  const rollbackReady = Boolean(rollbackTargetHash.trim() && rollbackActor.trim() && rollbackRationale.trim());

  return (
    <section className="policy-sandbox" id="policy-sandbox">
      <h2>Policy Sandbox</h2>
      <p>Run policy replay against historical intents and inspect impact summaries.</p>
      <div className="sandbox-card">
        <div className="sandbox-section">
          <h3>Candidate policy</h3>
          <div className="sandbox-row">
            <label>
              <input
                type="radio"
                name="candidate"
                value="current"
                checked={candidateSource === "current"}
                onChange={() => setCandidateSource("current")}
              />
              Current
            </label>
            <label>
              <input
                type="radio"
                name="candidate"
                value="path"
                checked={candidateSource === "path"}
                onChange={() => setCandidateSource("path")}
              />
              Path
            </label>
            <label>
              <input
                type="radio"
                name="candidate"
                value="inline"
                checked={candidateSource === "inline"}
                onChange={() => setCandidateSource("inline")}
              />
              Inline
            </label>
          </div>
          {candidateSource === "path" && (
            <div className="sandbox-row">
              <input
                type="text"
                value={candidatePath}
                list="policy-paths"
                onChange={(event) => setCandidatePath(event.target.value)}
              />
              <datalist id="policy-paths">
                <option value="policies.v1.yaml" />
              </datalist>
            </div>
          )}
          {candidateSource === "inline" && (
            <div className="sandbox-row sandbox-inline">
              <textarea value={inlineYaml} onChange={(event) => setInlineYaml(event.target.value)} rows={6} />
              <small>Requires POLICY_INLINE_ENABLED=true on the gateway.</small>
            </div>
          )}
        </div>
        <div className="sandbox-section">
          <h3>Filters</h3>
          <div className="sandbox-row">
            <label>
              Limit
              <input type="number" min={1} value={limit} onChange={(event) => setLimit(event.target.value)} />
            </label>
            <label>
              Intent types (comma-separated)
              <input
                type="text"
                value={intentTypes}
                onChange={(event) => setIntentTypes(event.target.value)}
                placeholder="CREATE_PO,CHECK_INVENTORY"
              />
            </label>
          </div>
        </div>
        <div className="sandbox-actions">
          <button type="button" onClick={handleReplay} disabled={loading}>
            {loading ? "Running..." : "Run Replay"}
          </button>
          {error && <span className="sandbox-error">{error}</span>}
        </div>
      </div>

      <div className="sandbox-card">
        <h3>Policy Impact Simulation</h3>
        <p>Compare a candidate policy to the active policy over historical intents.</p>
        <div className="sandbox-section">
          <label className="sandbox-notes">
            Candidate policy (paste or upload)
            <textarea
              value={impactPolicyYaml}
              onChange={(event) => setImpactPolicyYaml(event.target.value)}
              rows={6}
              placeholder="Paste candidate policy YAML"
            />
          </label>
          <div className="sandbox-row">
            <label>
              Upload policy file
              <input type="file" accept=".yaml,.yml,.txt" onChange={handleImpactUpload} />
            </label>
          </div>
        </div>
        <div className="sandbox-row">
          <label>
            Since
            <input
              type="datetime-local"
              value={impactSince}
              onChange={(event) => setImpactSince(event.target.value)}
            />
          </label>
          <label>
            Until
            <input
              type="datetime-local"
              value={impactUntil}
              onChange={(event) => setImpactUntil(event.target.value)}
            />
          </label>
          <label>
            Limit
            <input
              type="number"
              min={1}
              value={impactLimit}
              onChange={(event) => setImpactLimit(event.target.value)}
            />
          </label>
        </div>
        <div className="sandbox-actions">
          <button type="button" onClick={handleImpactSimulation} disabled={impactLoading}>
            {impactLoading ? "Simulating..." : "Run simulation"}
          </button>
          {impactError && <span className="sandbox-error">{impactError}</span>}
        </div>
      {impactReport && (
        <div className="sandbox-report">
            <div className="report-grid">
              <div>
                <strong>Blast radius</strong>
                <div className={blastRadiusClass(impactReport.blastRadiusScore)}>
                  {impactReport.blastRadiusScore}
                </div>
              </div>
              <div>
                <strong>Intents evaluated</strong>
                <div>{impactReport.totals.intentsEvaluated}</div>
              </div>
              <div>
                <strong>Newly blocked</strong>
                <div>{impactReport.totals.newlyBlocked}</div>
              </div>
              <div>
                <strong>Approval escalations</strong>
                <div>{impactReport.totals.approvalEscalations}</div>
              </div>
              <div>
                <strong>Severity increases</strong>
                <div>{impactReport.totals.severityIncreases}</div>
              </div>
              <div>
                <strong>Newly allowed</strong>
                <div>{impactReport.totals.newlyAllowed}</div>
              </div>
            </div>
            <h4>Impacted intents</h4>
            {impactedRows.length === 0 ? (
              <div>No impacted intents in this window.</div>
            ) : (
              <table className="sandbox-table">
                <thead>
                  <tr>
                    <th>Trace</th>
                    <th>Intent</th>
                    <th>Prev</th>
                    <th>Next</th>
                    <th>Approvals</th>
                    <th>Severity</th>
                    <th>Classifications</th>
                  </tr>
                </thead>
                <tbody>
                  {impactedRows.map((row) => (
                    <tr key={`${row.traceId}-${row.intentId}`}>
                      <td>{row.traceId}</td>
                      <td>{row.intentType}</td>
                      <td>{row.prevDecision}</td>
                      <td>{row.nextDecision}</td>
                      <td>
                        {row.prevApprovalsRequired.join(", ") || "none"} → {row.nextApprovalsRequired.join(", ") || "none"}
                      </td>
                      <td>
                        {row.prevSeverity} → {row.nextSeverity}
                      </td>
                      <td>{row.classifications.join(", ")}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        )}
      </div>

      <div className="sandbox-card">
        <h3>Promotion Guardrails</h3>
        <p>Evaluate deterministic promotion checks before activating a candidate policy.</p>
        <div className="sandbox-section">
          <div className="sandbox-row">
            <strong>Candidate hash</strong>
            <span>{guardrailCandidateHash || "Run a replay or select the current policy to resolve a hash."}</span>
          </div>
          <div className="sandbox-actions">
            <button type="button" onClick={handlePromotionCheck} disabled={!guardrailCandidateHash || guardrailCheckLoading}>
              {guardrailCheckLoading ? "Checking..." : "Check Promotion"}
            </button>
            {guardrailCheckError && <span className="sandbox-error">{guardrailCheckError}</span>}
          </div>
        </div>

        {guardrailDecision && (
          <div className="sandbox-report">
            <div className="report-grid">
              <div>
                <strong>Status</strong>
                <div className={guardrailDecision.allowed ? "impact-ok" : "impact-blocked"}>
                  {guardrailDecision.allowed ? "Allowed" : "Blocked"}
                </div>
              </div>
              <div>
                <strong>Health</strong>
                <div>{guardrailDecision.snapshot.drift.health.state}</div>
              </div>
              <div>
                <strong>Blast radius</strong>
                <div>{guardrailDecision.snapshot.impact.blastRadiusScore}</div>
              </div>
              <div>
                <strong>Impacted intents</strong>
                <div>{guardrailDecision.snapshot.impact.impactedIntents}</div>
              </div>
              <div>
                <strong>Quality score</strong>
                <div>{guardrailDecision.snapshot.quality.score.toFixed(2)}</div>
              </div>
              <div>
                <strong>Evaluated</strong>
                <div>{new Date(guardrailDecision.snapshot.evaluatedAt).toLocaleString()}</div>
              </div>
            </div>
            <div>
              <strong>Reasons</strong>
              {guardrailDecision.reasons.length ? (
                <ul>
                  {guardrailDecision.reasons.map((reason) => (
                    <li key={reason.code}>
                      {reason.code}: {reason.message} ({reason.metric} / {reason.threshold})
                    </li>
                  ))}
                </ul>
              ) : (
                <div>No guardrail issues detected.</div>
              )}
            </div>
          </div>
        )}

        <div className="sandbox-card sandbox-approval">
          <h4>Promote with guardrails</h4>
          <div className="sandbox-row">
            <label>
              Reviewer
              <input
                type="text"
                value={guardrailReviewer}
                onChange={(event) => setGuardrailReviewer(event.target.value)}
                placeholder="Reviewer name"
              />
            </label>
            <label>
              Rationale
              <input
                type="text"
                value={guardrailRationale}
                onChange={(event) => setGuardrailRationale(event.target.value)}
                placeholder="Explain promotion acceptance"
              />
            </label>
            <label>
              Accepted risk
              <input
                type="number"
                min={0}
                value={guardrailAcceptedRisk}
                onChange={(event) => setGuardrailAcceptedRisk(event.target.value)}
                placeholder="e.g. 12"
              />
            </label>
          </div>
          {guardrailRequiresAcceptance && (
            <div className="sandbox-row">
              <span>Accepted risk is required for this promotion.</span>
            </div>
          )}
          {guardrailNeedsForce && (
            <div className="sandbox-row">
              <label>
                <input
                  type="checkbox"
                  checked={guardrailForce}
                  onChange={(event) => setGuardrailForce(event.target.checked)}
                />
                Force promote (override guardrail block)
              </label>
            </div>
          )}
          <div className="sandbox-actions">
            <button type="button" onClick={handleGuardrailPromote} disabled={guardrailPromoteDisabled}>
              {guardrailPromotionLoading ? "Promoting..." : "Promote"}
            </button>
            {guardrailPromotionStatus && <span className="sandbox-success">{guardrailPromotionStatus}</span>}
            {guardrailPromotionError && <span className="sandbox-error">{guardrailPromotionError}</span>}
          </div>
        </div>
      </div>

      <div className="sandbox-card">
        <h3>Policy Lifecycle</h3>
        <p>Derived state and ordered lifecycle events for the active policy hash.</p>
        {lifecycleError && <span className="sandbox-error">{lifecycleError}</span>}
        {!lifecycleTimeline && !lifecycleError && <span>Loading lifecycle timeline...</span>}
        {lifecycleTimeline && (
          <>
            <div className="sandbox-row">
              <strong>Current state</strong>
              <span className={lifecycleBadgeClass(lifecycleTimeline.state)}>{lifecycleTimeline.state}</span>
            </div>
            {lifecycleTimeline.events.length === 0 ? (
              <div className="lifecycle-empty">No lifecycle events recorded yet.</div>
            ) : (
              <ul className="lifecycle-timeline">
                {lifecycleTimeline.events.map((event, index) => (
                  <li key={`${event.type}-${event.timestamp}-${event.actor}-${index}`}>
                    <div className="lifecycle-event-header">
                      <span className="lifecycle-event-type">{lifecycleEventLabel(event.type)}</span>
                      <span className="lifecycle-event-time">
                        {new Date(event.timestamp).toLocaleString()}
                      </span>
                    </div>
                    <div className="lifecycle-event-meta">
                      <span className="lifecycle-event-actor">{event.actor}</span>
                      <span className="lifecycle-event-rationale">{event.rationale}</span>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </>
        )}
      </div>

      <div className="sandbox-card">
        <h3>Policy Rollback</h3>
        <p>Roll back to a previously promoted policy hash with deterministic guardrails.</p>
        <div className="sandbox-row">
          <label>
            Target policy hash
            <select
              value={rollbackTargetHash}
              onChange={(event) => setRollbackTargetHash(event.target.value)}
              disabled={!rollbackCandidates.length}
            >
              {rollbackCandidates.length === 0 && <option value="">No promoted policies available</option>}
              {rollbackCandidates.map((record) => (
                <option key={record.policyHash} value={record.policyHash}>
                  {record.policyHash} (promoted {new Date(record.promotedAt).toLocaleString()})
                </option>
              ))}
            </select>
          </label>
          <label>
            Actor
            <input
              type="text"
              value={rollbackActor}
              onChange={(event) => setRollbackActor(event.target.value)}
              placeholder="Rollback operator"
            />
          </label>
          <label>
            Rationale
            <input
              type="text"
              value={rollbackRationale}
              onChange={(event) => setRollbackRationale(event.target.value)}
              placeholder="Explain the rollback"
            />
          </label>
        </div>
        <div className="sandbox-actions">
          <button type="button" onClick={() => handleRollback(true)} disabled={!rollbackReady || rollbackLoading}>
            {rollbackLoading ? "Running..." : "Dry Run Rollback"}
          </button>
          <button type="button" onClick={() => handleRollback(false)} disabled={!rollbackReady || rollbackLoading}>
            {rollbackLoading ? "Rolling back..." : "Rollback"}
          </button>
          {rollbackStatus && <span className="sandbox-success">{rollbackStatus}</span>}
          {rollbackError && <span className="sandbox-error">{rollbackError}</span>}
        </div>
        {rollbackDecision && (
          <div className="sandbox-report">
            <div className="report-grid">
              <div>
                <strong>Status</strong>
                <div className={rollbackDecision.ok ? "impact-badge impact-badge-low" : "impact-badge impact-badge-high"}>
                  {rollbackDecision.ok ? "Approved" : "Rejected"}
                </div>
              </div>
              <div>
                <strong>Decision hash</strong>
                <div>{rollbackDecision.decisionHash}</div>
              </div>
              <div>
                <strong>From → To</strong>
                <div>
                  {rollbackDecision.fromPolicyHash} → {rollbackDecision.toPolicyHash}
                </div>
              </div>
              <div>
                <strong>Created</strong>
                <div>{new Date(rollbackDecision.createdAt).toLocaleString()}</div>
              </div>
            </div>
            {rollbackDecision.reasons.length > 0 && (
              <div>
                <strong>Reasons</strong>
                <ul>
                  {rollbackDecision.reasons.map((reason) => (
                    <li key={reason}>{reason}</li>
                  ))}
                </ul>
              </div>
            )}
            {rollbackEvent && (
              <div>
                <strong>Rollback event</strong>
                <div>Event hash: {rollbackEvent.eventHash}</div>
              </div>
            )}
          </div>
        )}
      </div>

      <div className="sandbox-card">
        <h3>Policy Reconciliation</h3>
        <p>Compare two policy hashes or a time window with semantic diffs.</p>
        <div className="sandbox-row">
          <label>
            From policy hash
            <input
              type="text"
              value={reconcileFromHash}
              onChange={(event) => setReconcileFromHash(event.target.value)}
              disabled={reconcileUseWindow}
              placeholder="From policy hash"
            />
          </label>
          <label>
            To policy hash
            <input
              type="text"
              value={reconcileToHash}
              onChange={(event) => setReconcileToHash(event.target.value)}
              disabled={reconcileUseWindow}
              placeholder="To policy hash"
            />
          </label>
        </div>
        <div className="sandbox-row">
          <label>
            <input
              type="checkbox"
              checked={reconcileUseWindow}
              onChange={(event) => setReconcileUseWindow(event.target.checked)}
            />
            Use time window instead of hashes
          </label>
        </div>
        {reconcileUseWindow && (
          <div className="sandbox-row">
            <label>
              Since
              <input
                type="datetime-local"
                value={reconcileSince}
                onChange={(event) => setReconcileSince(event.target.value)}
              />
            </label>
            <label>
              Until
              <input
                type="datetime-local"
                value={reconcileUntil}
                onChange={(event) => setReconcileUntil(event.target.value)}
              />
            </label>
          </div>
        )}
        <div className="sandbox-actions">
          <button type="button" onClick={handleReconcile} disabled={reconcileLoading}>
            {reconcileLoading ? "Reconciling..." : "Reconcile"}
          </button>
          {reconcileError && <span className="sandbox-error">{reconcileError}</span>}
        </div>
        {reconcileReport && (
          <div className="sandbox-report">
            <div className="report-grid">
              <div>
                <strong>Rules added</strong>
                <div className="impact-badge impact-badge-low">{reconcileReport.summary.rulesAdded}</div>
              </div>
              <div>
                <strong>Rules removed</strong>
                <div className="impact-badge impact-badge-high">{reconcileReport.summary.rulesRemoved}</div>
              </div>
              <div>
                <strong>Rules modified</strong>
                <div className="impact-badge impact-badge-medium">{reconcileReport.summary.rulesModified}</div>
              </div>
              <div>
                <strong>Defaults changed</strong>
                <div>{reconcileReport.summary.defaultsChanged ? "Yes" : "No"}</div>
              </div>
              <div>
                <strong>Approvals added</strong>
                <div>{reconcileReport.summary.approvalsAdded.join(", ") || "none"}</div>
              </div>
              <div>
                <strong>Approvals removed</strong>
                <div>{reconcileReport.summary.approvalsRemoved.join(", ") || "none"}</div>
              </div>
              <div>
                <strong>Auto-exec approvals changed</strong>
                <div>{reconcileReport.summary.autoExecutionApprovalsChanged ? "Yes" : "No"}</div>
              </div>
              <div>
                <strong>Report hash</strong>
                <div>{reconcileReport.reportHash}</div>
              </div>
            </div>
            <details>
              <summary>Rules added ({reconcileReport.rulesAdded.length})</summary>
              {reconcileReport.rulesAdded.length === 0 ? (
                <div>No rules added.</div>
              ) : (
                <ul>
                  {reconcileReport.rulesAdded.map((rule) => (
                    <li key={rule.ruleId}>
                      {rule.ruleId} · approvals: {rule.approvalRoles.join(", ") || "none"}
                    </li>
                  ))}
                </ul>
              )}
            </details>
            <details>
              <summary>Rules removed ({reconcileReport.rulesRemoved.length})</summary>
              {reconcileReport.rulesRemoved.length === 0 ? (
                <div>No rules removed.</div>
              ) : (
                <ul>
                  {reconcileReport.rulesRemoved.map((rule) => (
                    <li key={rule.ruleId}>
                      {rule.ruleId} · approvals: {rule.approvalRoles.join(", ") || "none"}
                    </li>
                  ))}
                </ul>
              )}
            </details>
            <details>
              <summary>Rules modified ({reconcileReport.rulesModified.length})</summary>
              {reconcileReport.rulesModified.length === 0 ? (
                <div>No rules modified.</div>
              ) : (
                <div className="sandbox-section">
                  {reconcileReport.rulesModified.map((rule) => (
                    <details key={rule.ruleId}>
                      <summary>{rule.ruleId}</summary>
                      <div className="sandbox-section">
                        <div>
                          <strong>Changes</strong>
                          <ul>
                            <li>Enabled changed: {rule.changes.enabledChanged ? "Yes" : "No"}</li>
                            <li>Decision changed: {rule.changes.decisionChanged ? "Yes" : "No"}</li>
                            <li>Priority Δ: {rule.changes.priorityDelta}</li>
                            <li>Tags added: {rule.changes.tagsAdded.join(", ") || "none"}</li>
                            <li>Tags removed: {rule.changes.tagsRemoved.join(", ") || "none"}</li>
                            <li>Intent types added: {rule.changes.intentTypesAdded.join(", ") || "none"}</li>
                            <li>Intent types removed: {rule.changes.intentTypesRemoved.join(", ") || "none"}</li>
                            <li>Approvals added: {rule.changes.approvalsAdded.join(", ") || "none"}</li>
                            <li>Approvals removed: {rule.changes.approvalsRemoved.join(", ") || "none"}</li>
                            <li>Constraints added: {rule.changes.constraintsAdded.length}</li>
                            <li>Constraints removed: {rule.changes.constraintsRemoved.length}</li>
                          </ul>
                        </div>
                        <div>
                          <strong>Before</strong>
                          <pre className="sandbox-pre">{JSON.stringify(rule.before.rule, null, 2)}</pre>
                        </div>
                        <div>
                          <strong>After</strong>
                          <pre className="sandbox-pre">{JSON.stringify(rule.after.rule, null, 2)}</pre>
                        </div>
                      </div>
                    </details>
                  ))}
                </div>
              )}
            </details>
          </div>
        )}
      </div>

      <div className="sandbox-card">
        <h3>Current policy lineage</h3>
        {lineageError && <span className="sandbox-error">{lineageError}</span>}
        {!lineage && !lineageError && <span>Loading lineage...</span>}
        {lineage && (
          <>
            <div className="sandbox-row">
              <strong>Active policy hash:</strong> <span>{lineage.policyHash}</span>
            </div>
            <table className="sandbox-table">
              <thead>
                <tr>
                  <th>Policy hash</th>
                  <th>Parent</th>
                  <th>Promoted by</th>
                  <th>Promoted at</th>
                  <th>Rationale</th>
                  <th>Accepted risk</th>
                  <th>Drift (added/removed)</th>
                  <th>Severity Δ</th>
                  <th>Risk score Δ</th>
                </tr>
              </thead>
              <tbody>
                {lineage.lineage.map((entry) => (
                  <tr key={entry.policyHash}>
                    <td>{entry.policyHash}</td>
                    <td>{entry.parentPolicyHash ?? "root"}</td>
                    <td>{entry.promotedBy}</td>
                    <td>{new Date(entry.promotedAt).toLocaleString()}</td>
                    <td>{entry.rationale}</td>
                    <td>{entry.acceptedRiskScore}</td>
                    <td>
                      +{entry.drift.constraintsAdded}/-{entry.drift.constraintsRemoved}
                    </td>
                    <td>{entry.drift.severityDelta}</td>
                    <td>{entry.drift.netRiskScoreChange}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </>
        )}
      </div>

      <div className="sandbox-card">
        <h3>Policy health</h3>
        {policyDriftLoading && <span>Loading drift health...</span>}
        {policyDriftError && <span className="sandbox-error">{policyDriftError}</span>}
        {!policyDriftLoading && !policyDrift && !policyDriftError && (
          <span>Load an active policy to see drift health.</span>
        )}
        {policyDrift && (
          <>
            <div className="report-grid">
              <div>
                <strong>Health state</strong>
                <div>{policyDrift.report.health.state}</div>
              </div>
              <div>
                <strong>Policy hash</strong>
                <div>{policyDrift.report.policyHash}</div>
              </div>
              <div>
                <strong>Replay delta</strong>
                <div>{policyDrift.report.deltas.replayDelta}</div>
              </div>
            </div>
            <div className="sandbox-table">
              <table>
                <thead>
                  <tr>
                    <th>Metric</th>
                    <th>Recent</th>
                    <th>Baseline</th>
                  </tr>
                </thead>
                <tbody>
                  <tr>
                    <td>Failure rate</td>
                    <td>{(policyDrift.report.recent.metrics.failureRate * 100).toFixed(2)}%</td>
                    <td>{(policyDrift.report.baseline.metrics.failureRate * 100).toFixed(2)}%</td>
                  </tr>
                  <tr>
                    <td>Override rate</td>
                    <td>{(policyDrift.report.recent.metrics.overrideRate * 100).toFixed(2)}%</td>
                    <td>{(policyDrift.report.baseline.metrics.overrideRate * 100).toFixed(2)}%</td>
                  </tr>
                  <tr>
                    <td>Quality score</td>
                    <td>{policyDrift.report.recent.metrics.qualityScore.toFixed(1)}</td>
                    <td>{policyDrift.report.baseline.metrics.qualityScore.toFixed(1)}</td>
                  </tr>
                  <tr>
                    <td>Replay added</td>
                    <td>{policyDrift.report.recent.metrics.replayAdded}</td>
                    <td>{policyDrift.report.baseline.metrics.replayAdded}</td>
                  </tr>
                  <tr>
                    <td>Replay removed</td>
                    <td>{policyDrift.report.recent.metrics.replayRemoved}</td>
                    <td>{policyDrift.report.baseline.metrics.replayRemoved}</td>
                  </tr>
                </tbody>
              </table>
            </div>
            <div>
              <strong>Rationale</strong>
              {policyDrift.report.health.rationale.length ? (
                <ul>
                  {policyDrift.report.health.rationale.map((item) => (
                    <li key={item}>{item}</li>
                  ))}
                </ul>
              ) : (
                <div>No drift triggers in this window.</div>
              )}
            </div>
          </>
        )}
      </div>

      <div className="sandbox-card">
        <h3>Policy quality</h3>
        {policyQualityLoading && <span>Loading quality metrics...</span>}
        {policyQualityError && <span className="sandbox-error">{policyQualityError}</span>}
        {!policyQualityLoading && !policyQuality && !policyQualityError && (
          <span>Load an active policy to see outcome quality.</span>
        )}
        {policyQuality && (
          <div className="report-grid">
            <div>
              <strong>Policy hash</strong>
              <div>{policyQuality.policyHash}</div>
            </div>
            <div>
              <strong>Total outcomes</strong>
              <div>{policyQuality.metrics.totalOutcomes}</div>
            </div>
            <div>
              <strong>Failure rate</strong>
              <div>{(policyQuality.metrics.failureRate * 100).toFixed(1)}%</div>
            </div>
            <div>
              <strong>Override rate</strong>
              <div>{(policyQuality.metrics.overrideRate * 100).toFixed(1)}%</div>
            </div>
            <div>
              <strong>Quality score</strong>
              <div>{policyQuality.metrics.qualityScore.toFixed(1)}</div>
            </div>
          </div>
        )}
      </div>

      <div className="sandbox-card">
        <h3>Determinism / Integrity</h3>
        <p>Verify that derived policy state is reproducible from the ordered event log.</p>
        <div className="sandbox-row">
          <label>
            Policy hash
            <input
              type="text"
              value={verificationPolicyHash}
              onChange={(event) => setVerificationPolicyHash(event.target.value)}
              placeholder="policy hash"
            />
          </label>
          <label>
            Since
            <input
              type="datetime-local"
              value={verificationSince}
              onChange={(event) => setVerificationSince(event.target.value)}
            />
          </label>
          <label>
            Until
            <input
              type="datetime-local"
              value={verificationUntil}
              onChange={(event) => setVerificationUntil(event.target.value)}
            />
          </label>
        </div>
        <div className="sandbox-actions">
          <button
            type="button"
            onClick={handleVerification}
            disabled={verificationLoading || !verificationPolicyHash.trim()}
          >
            {verificationLoading ? "Verifying..." : "Verify"}
          </button>
          {verificationError && <span className="sandbox-error">{verificationError}</span>}
        </div>
        {verificationResult && (
          <div className="sandbox-report">
            <div className="report-grid">
              <div>
                <strong>Status</strong>
                <div
                  className={
                    verificationResult.verified
                      ? "integrity-status integrity-status-verified"
                      : "integrity-status integrity-status-inconsistent"
                  }
                >
                  {verificationResult.verified ? "VERIFIED" : "INCONSISTENT"}
                </div>
              </div>
              <div>
                <strong>Event count</strong>
                <div>{verificationResult.eventCount}</div>
              </div>
              <div>
                <strong>Last event hash</strong>
                <div>{verificationResult.lastEventHash ?? "n/a"}</div>
              </div>
            </div>
            {!verificationResult.verified && verificationResult.mismatches.length > 0 && (
              <div className="sandbox-section">
                <strong>First mismatch</strong>
                <div className="mismatch-summary">
                  {verificationResult.mismatches[0].field}
                </div>
                <div className="mismatch-detail">
                  <div>
                    <strong>Expected</strong>
                    <pre>{JSON.stringify(verificationResult.mismatches[0].expected, null, 2)}</pre>
                  </div>
                  <div>
                    <strong>Actual</strong>
                    <pre>{JSON.stringify(verificationResult.mismatches[0].actual, null, 2)}</pre>
                  </div>
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      <div className="sandbox-card">
        <h3>Execution Gate</h3>
        <p>Review policy decisions, capture approvals, and trigger execution for a trace ID.</p>
        <div className="sandbox-row">
          <label>
            Trace ID
            <input
              type="text"
              value={executionTraceId}
              onChange={(event) => setExecutionTraceId(event.target.value)}
              placeholder="trace-id"
            />
          </label>
          <label>
            Actor
            <input
              type="text"
              value={executionApprover}
              onChange={(event) => setExecutionApprover(event.target.value)}
              placeholder="local-user"
            />
          </label>
        </div>
        <div className="sandbox-row">
          <label className="sandbox-notes">
            Rationale
            <textarea
              value={executionRationale}
              onChange={(event) => setExecutionRationale(event.target.value)}
              rows={2}
              placeholder="Reason for approval or execution"
            />
          </label>
        </div>
        {executionDecisionLoading && <span>Loading decision...</span>}
        {executionDecisionError && <span className="sandbox-error">{executionDecisionError}</span>}
        {executionDecision && (
          <div className="report-grid">
            <div>
              <strong>Outcome</strong>
              <div>{executionDecision.decision.outcome}</div>
            </div>
            <div>
              <strong>Policy hash</strong>
              <div>{executionDecision.policyHash}</div>
            </div>
            <div>
              <strong>Action</strong>
              <div>{executionDecision.plan?.action ?? "n/a"}</div>
            </div>
            <div>
              <strong>Required approvals</strong>
              {executionDecision.decision.requiredApprovals.length > 0 ? (
                <ul>
                  {executionDecision.decision.requiredApprovals.map((approval) => (
                    <li key={approval.role}>
                      {approval.role} — {approval.reason}
                    </li>
                  ))}
                </ul>
              ) : (
                <div>No approvals required.</div>
              )}
            </div>
          </div>
        )}
        {executionApprovals.length > 0 && (
          <div className="sandbox-section">
            <strong>Recorded approvals</strong>
            <ul>
              {executionApprovals.map((approval) => (
                <li key={`${approval.requiredRole}-${approval.actor}-${approval.approvedAt}`}>
                  {approval.requiredRole} approved by {approval.actor} at {new Date(approval.approvedAt).toLocaleString()}
                </li>
              ))}
            </ul>
          </div>
        )}
        <div className="sandbox-actions">
          {executionDecision?.decision.requiredApprovals.map((approval) => (
            <button
              key={approval.role}
              type="button"
              onClick={() => handleExecutionApprove(approval.role)}
              disabled={!executionTraceId.trim()}
            >
              Approve as {approval.role}
            </button>
          ))}
          <button type="button" onClick={handleExecution} disabled={!executionTraceId.trim()}>
            Execute
          </button>
          {executionApprovalStatus && <span className="sandbox-success">{executionApprovalStatus}</span>}
          {executionApprovalError && <span className="sandbox-error">{executionApprovalError}</span>}
          {executionStatus && <span className="sandbox-success">{executionStatus}</span>}
          {executionError && <span className="sandbox-error">{executionError}</span>}
        </div>
        {executionMissingApprovals.length > 0 && (
          <div className="sandbox-error">
            Missing approvals: {executionMissingApprovals.join(", ")}
          </div>
        )}
      </div>

      <div className="sandbox-card">
        <h3>Record outcome</h3>
        <div className="sandbox-row">
          <label>
            Trace ID
            <input
              type="text"
              value={outcomeTraceId}
              onChange={(event) => setOutcomeTraceId(event.target.value)}
              placeholder="trace-id"
            />
          </label>
          <label>
            Outcome type
            <select value={outcomeType} onChange={(event) => setOutcomeType(event.target.value as PolicyOutcomeType)}>
              <option value="success">success</option>
              <option value="failure">failure</option>
              <option value="override">override</option>
              <option value="rollback">rollback</option>
            </select>
          </label>
          <label>
            Severity (1-5)
            <input
              type="number"
              min={1}
              max={5}
              value={outcomeSeverity}
              onChange={(event) => setOutcomeSeverity(event.target.value)}
            />
          </label>
          <label>
            Human override
            <input
              type="checkbox"
              checked={outcomeHumanOverride}
              onChange={(event) => setOutcomeHumanOverride(event.target.checked)}
            />
          </label>
        </div>
        <div className="sandbox-row">
          <label className="sandbox-notes">
            Notes
            <textarea
              value={outcomeNotes}
              onChange={(event) => setOutcomeNotes(event.target.value)}
              rows={3}
              placeholder="Optional context for the outcome"
            />
          </label>
        </div>
        <div className="sandbox-actions">
          <button
            type="button"
            onClick={handleOutcomeSubmit}
            disabled={!outcomeTraceId.trim() || !severityValid}
          >
            Record outcome
          </button>
          {outcomeStatus && <span className="sandbox-success">{outcomeStatus}</span>}
          {outcomeError && <span className="sandbox-error">{outcomeError}</span>}
        </div>
      </div>

      {report && (
        <div className="sandbox-report">
          <h3>Replay report</h3>
          <div className="report-grid">
            <div>
              <strong>Run</strong>
              <div>Run ID: {report.run.runId}</div>
              <div>Created: {new Date(report.run.createdAt).toLocaleString()}</div>
            </div>
            <div>
              <strong>Totals</strong>
              <div>Count: {report.totals.count}</div>
              <div>Changed: {report.totals.changed}</div>
              <div>Unchanged: {report.totals.unchanged}</div>
            </div>
            <div>
              <strong>Deltas</strong>
              <div>Allow: {report.deltas.allowDelta}</div>
              <div>Warn: {report.deltas.warnDelta}</div>
              <div>Deny: {report.deltas.denyDelta}</div>
            </div>
            <div>
              <strong>Impact</strong>
              <div>Score: {report.impact.score}</div>
              <div>Changed decisions: {report.impact.counts.changedDecisions}</div>
              <div>Deny → Allow flips: {report.impact.counts.denyToAllowFlips}</div>
              <div>Rate-limit hits: {report.impact.counts.rateLimitViolations}</div>
              <div>High-risk signals: {report.impact.counts.highRiskSignals}</div>
              <div className={report.impact.blocked ? "impact-blocked" : "impact-ok"}>
                {report.impact.blocked ? "Promotion blocked" : "Promotion eligible"}
              </div>
            </div>
          </div>

          <div className="sandbox-card sandbox-approval">
            <h4>Promotion approval</h4>
            <div className="sandbox-row">
              <label>
                Approved by
                <input
                  type="text"
                  value={approver}
                  onChange={(event) => setApprover(event.target.value)}
                  placeholder="Analyst name"
                />
              </label>
              <label>
                Rationale
                <input
                  type="text"
                  value={approvalRationale}
                  onChange={(event) => setApprovalRationale(event.target.value)}
                  placeholder="Explain why the promotion is acceptable"
                />
              </label>
              <label>
                Accepted risk score
                <input
                  type="number"
                  min={0}
                  value={acceptedRiskScore}
                  onChange={(event) => setAcceptedRiskScore(event.target.value)}
                  placeholder="e.g. 12"
                />
              </label>
            </div>
            <div className="sandbox-row">
              <label className="sandbox-notes">
                Approval notes
                <textarea
                  value={approvalNotes}
                  onChange={(event) => setApprovalNotes(event.target.value)}
                  rows={3}
                  placeholder="Optional details for audit trail"
                />
              </label>
            </div>
            <div className="sandbox-actions">
              <button
                type="button"
                onClick={handlePromote}
                disabled={
                  promotionLoading ||
                  report.impact.blocked ||
                  !approver.trim() ||
                  approvalRationale.trim().length < 10 ||
                  !acceptedRiskScore.trim() ||
                  !Number.isFinite(Number(acceptedRiskScore))
                }
              >
                {promotionLoading ? "Promoting..." : "Promote policy"}
              </button>
              {promotionStatus && <span className="sandbox-success">{promotionStatus}</span>}
              {promotionError && <span className="sandbox-error">{promotionError}</span>}
            </div>
          </div>

          <h4>By intent type</h4>
          <table className="sandbox-table">
            <thead>
              <tr>
                <th>Intent</th>
                <th>Count</th>
                <th>Changed</th>
                <th>Baseline (A/W/D)</th>
                <th>Candidate (A/W/D)</th>
              </tr>
            </thead>
            <tbody>
              {report.byIntentType.map((entry) => (
                <tr key={entry.intentType}>
                  <td>{entry.intentType}</td>
                  <td>{entry.count}</td>
                  <td>{entry.changed}</td>
                  <td>
                    {entry.baseline.allow}/{entry.baseline.warn}/{entry.baseline.deny}
                  </td>
                  <td>
                    {entry.candidate.allow}/{entry.candidate.warn}/{entry.candidate.deny}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>

          <h4>Top rule changes</h4>
          <ul className="sandbox-list">
            {report.topRuleChanges.map((entry) => (
              <li key={entry.ruleId}>
                <strong>{entry.ruleId}</strong> — {entry.changedCount} changes ({entry.direction})
              </li>
            ))}
          </ul>

          <h4>Top changed examples</h4>
          <ul className="sandbox-list">
            {report.topChangedExamples.map((entry) => (
              <li key={entry.traceId}>
                <button type="button" onClick={() => handleTraceExplain(entry.traceId)}>
                  {entry.traceId}
                </button>
                <span>
                  {entry.intentType}: {entry.baselineDecision} → {entry.candidateDecision}
                </span>
              </li>
            ))}
          </ul>

          <h4>Trace explain</h4>
          <pre className="sandbox-pre">{traceExplain || "Select a trace to load explainability."}</pre>
        </div>
      )}
    </section>
  );
}
