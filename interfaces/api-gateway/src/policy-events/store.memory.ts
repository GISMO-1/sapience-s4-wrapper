import type { PolicyEvent } from "./types";
import type { PolicyEventStore } from "./store";

function sortEvents(a: PolicyEvent, b: PolicyEvent): number {
  const timeDiff = new Date(a.occurredAt).getTime() - new Date(b.occurredAt).getTime();
  if (timeDiff !== 0) {
    return timeDiff;
  }
  if (a.kind !== b.kind) {
    return a.kind.localeCompare(b.kind);
  }
  return a.eventId.localeCompare(b.eventId);
}

export class InMemoryPolicyEventStore implements PolicyEventStore {
  private readonly events: PolicyEvent[] = [];

  async appendEvents(events: PolicyEvent[]): Promise<void> {
    events.forEach((event) => this.events.push(event));
  }

  async listEvents(filters?: {
    policyHash?: string;
    since?: Date;
    until?: Date;
    limit?: number;
  }): Promise<PolicyEvent[]> {
    const since = filters?.since?.getTime();
    const until = filters?.until?.getTime();
    const limit = filters?.limit ?? 200;

    return this.events
      .filter((event) => {
        if (filters?.policyHash && event.policyHash !== filters.policyHash) {
          return false;
        }
        const occurredAt = new Date(event.occurredAt).getTime();
        if (since && occurredAt < since) {
          return false;
        }
        if (until && occurredAt > until) {
          return false;
        }
        return true;
      })
      .slice()
      .sort(sortEvents)
      .slice(0, limit);
  }
}
