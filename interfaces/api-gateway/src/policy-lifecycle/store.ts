import { config } from "../config";
import type { PolicySnapshotStatus, PolicyLifecycleRecord, PolicyApproval } from "./types";

export type PolicyLifecycleStore = {
  getStatus: (hash: string) => PolicyLifecycleRecord | null;
  listStatuses: () => PolicyLifecycleRecord[];
  registerDraft: (input: { hash: string; source?: PolicySnapshotStatus["source"]; ref?: string | null }) => PolicyLifecycleRecord;
  markSimulated: (input: { hash: string; source?: PolicySnapshotStatus["source"]; ref?: string | null }) => PolicyLifecycleRecord;
  setActivePolicy: (input: { hash: string; version: string; path: string; loadedAt: string }) => PolicyLifecycleRecord;
  promotePolicy: (input: { hash: string; approval: PolicyApproval; source?: PolicySnapshotStatus["source"]; ref?: string | null }) => PolicyLifecycleRecord;
  getActivePolicy: () => PolicyLifecycleRecord | null;
};

export class InMemoryPolicyLifecycleStore implements PolicyLifecycleStore {
  private readonly records = new Map<string, PolicyLifecycleRecord>();
  private activePolicyHash: string | null = null;

  constructor(private readonly now: () => Date = () => new Date()) {}

  getStatus(hash: string): PolicyLifecycleRecord | null {
    return this.records.get(hash) ?? null;
  }

  listStatuses(): PolicyLifecycleRecord[] {
    return Array.from(this.records.values()).sort((a, b) => a.policyHash.localeCompare(b.policyHash));
  }

  registerDraft(input: { hash: string; source?: PolicySnapshotStatus["source"]; ref?: string | null }): PolicyLifecycleRecord {
    const existing = this.records.get(input.hash);
    if (existing) {
      return existing;
    }
    const record: PolicyLifecycleRecord = {
      policyHash: input.hash,
      state: "draft",
      source: input.source,
      ref: input.ref ?? null,
      updatedAt: this.now().toISOString()
    };
    this.records.set(input.hash, record);
    return record;
  }

  markSimulated(input: { hash: string; source?: PolicySnapshotStatus["source"]; ref?: string | null }): PolicyLifecycleRecord {
    const record: PolicyLifecycleRecord = {
      policyHash: input.hash,
      state: "simulated",
      source: input.source,
      ref: input.ref ?? null,
      updatedAt: this.now().toISOString(),
      approval: this.records.get(input.hash)?.approval
    };
    this.records.set(input.hash, record);
    return record;
  }

  setActivePolicy(input: { hash: string; version: string; path: string; loadedAt: string }): PolicyLifecycleRecord {
    const existing = this.records.get(input.hash);
    const record: PolicyLifecycleRecord = {
      policyHash: input.hash,
      state: "active",
      updatedAt: this.now().toISOString(),
      version: input.version,
      path: input.path,
      loadedAt: input.loadedAt,
      approval: existing?.approval,
      source: existing?.source,
      ref: existing?.ref ?? null
    };
    this.records.set(input.hash, record);
    this.activePolicyHash = input.hash;
    return record;
  }

  promotePolicy(input: { hash: string; approval: PolicyApproval; source?: PolicySnapshotStatus["source"]; ref?: string | null }): PolicyLifecycleRecord {
    if (this.activePolicyHash && this.activePolicyHash !== input.hash) {
      const active = this.records.get(this.activePolicyHash);
      if (active) {
        this.records.set(this.activePolicyHash, {
          ...active,
          state: active.state === "active" ? "approved" : active.state,
          updatedAt: this.now().toISOString()
        });
      }
    }
    const record: PolicyLifecycleRecord = {
      policyHash: input.hash,
      state: "active",
      updatedAt: this.now().toISOString(),
      approval: input.approval,
      source: input.source,
      ref: input.ref ?? null,
      version: this.records.get(input.hash)?.version,
      path: this.records.get(input.hash)?.path,
      loadedAt: this.records.get(input.hash)?.loadedAt
    };
    this.records.set(input.hash, record);
    this.activePolicyHash = input.hash;
    return record;
  }

  getActivePolicy(): PolicyLifecycleRecord | null {
    if (!this.activePolicyHash) {
      return null;
    }
    return this.records.get(this.activePolicyHash) ?? null;
  }
}

export function createPolicyLifecycleStore(): PolicyLifecycleStore {
  if (config.useInMemoryStore) {
    return new InMemoryPolicyLifecycleStore();
  }
  return new InMemoryPolicyLifecycleStore();
}
