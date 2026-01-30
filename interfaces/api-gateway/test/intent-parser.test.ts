import { expect, test } from "vitest";
import { parseIntent } from "../src/intent/intent-parser";

test("parses invoice intent with confidence", () => {
  const intent = parseIntent("Review invoice INV-1002 for vendor Northwind");
  expect(intent.intentType).toBe("REVIEW_INVOICE");
  expect(intent.confidence).toBeGreaterThanOrEqual(0.6);
  expect(intent.entities.invoiceId).toBe("INV-1002");
});
