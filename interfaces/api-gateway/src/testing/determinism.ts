import { randomUUID } from "node:crypto";

export type DeterminismConfig = {
  start?: Date;
  stepMs?: number;
  idPrefix?: string;
  idStart?: number;
};

let deterministic = false;
let currentTime = Date.now();
let stepMs = 1;
let idPrefix = "deterministic";
let idCounter = 0;

export function configureDeterminism(config?: DeterminismConfig): void {
  deterministic = true;
  currentTime = (config?.start ?? new Date()).getTime();
  stepMs = config?.stepMs ?? 1;
  idPrefix = config?.idPrefix ?? "deterministic";
  idCounter = config?.idStart ?? 0;
}

export function resetDeterminism(): void {
  deterministic = false;
  currentTime = Date.now();
  stepMs = 1;
  idPrefix = "deterministic";
  idCounter = 0;
}

export function isDeterministic(): boolean {
  return deterministic;
}

export function now(): Date {
  if (!deterministic) {
    return new Date();
  }
  const value = new Date(currentTime);
  currentTime += stepMs;
  return value;
}

export function nowMs(): number {
  if (!deterministic) {
    return Date.now();
  }
  const value = currentTime;
  currentTime += stepMs;
  return value;
}

export function generateId(): string {
  if (!deterministic) {
    return randomUUID();
  }
  idCounter += 1;
  return `${idPrefix}-${String(idCounter).padStart(4, "0")}`;
}
