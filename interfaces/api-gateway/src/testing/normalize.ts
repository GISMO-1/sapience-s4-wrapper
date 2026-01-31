type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };

const ROUND_DECIMALS = 4;

function roundNumber(value: number): number {
  if (!Number.isFinite(value)) {
    return value;
  }
  return Number(value.toFixed(ROUND_DECIMALS));
}

function normalizeArray(values: JsonValue[]): JsonValue[] {
  const normalized = values.map((value) => normalizeValue(value));
  const sortable = normalized.every(
    (value) => typeof value === "string" || typeof value === "number" || typeof value === "boolean" || value === null
  );
  if (sortable) {
    return normalized.slice().sort((a, b) => String(a).localeCompare(String(b)));
  }
  return normalized
    .slice()
    .sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
}

function normalizeObject(value: Record<string, JsonValue>): Record<string, JsonValue> {
  return Object.keys(value)
    .sort()
    .reduce<Record<string, JsonValue>>((acc, key) => {
      acc[key] = normalizeValue(value[key]);
      return acc;
    }, {});
}

export function normalizeValue(value: JsonValue): JsonValue {
  if (value === null) {
    return value;
  }
  if (Array.isArray(value)) {
    return normalizeArray(value);
  }
  if (typeof value === "number") {
    return roundNumber(value);
  }
  if (typeof value === "object") {
    return normalizeObject(value as Record<string, JsonValue>);
  }
  return value;
}

export function normalizeGoldenSnapshot<T>(input: T): T {
  return normalizeValue(input as JsonValue) as T;
}
