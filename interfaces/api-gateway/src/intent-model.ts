import { z } from "zod";

export const intentSchema = z.object({
  intentType: z.enum(["CREATE_PO", "CHECK_INVENTORY", "REVIEW_INVOICE"]),
  entities: z.record(z.unknown()),
  confidence: z.number().min(0).max(1)
});

export type Intent = z.infer<typeof intentSchema>;

export function parseIntent(text: string): Intent {
  const lowered = text.toLowerCase();
  if (lowered.includes("inventory") || lowered.includes("stock")) {
    return {
      intentType: "CHECK_INVENTORY",
      entities: extractEntities(text),
      confidence: 0.72
    };
  }
  if (lowered.includes("invoice")) {
    return {
      intentType: "REVIEW_INVOICE",
      entities: extractEntities(text),
      confidence: 0.74
    };
  }
  if (lowered.includes("order") || lowered.includes("po") || lowered.includes("low stock")) {
    return {
      intentType: "CREATE_PO",
      entities: extractEntities(text),
      confidence: 0.78
    };
  }
  return {
    intentType: "CHECK_INVENTORY",
    entities: extractEntities(text),
    confidence: 0.4
  };
}

function extractEntities(text: string): Record<string, unknown> {
  const skuMatch = text.match(/sku\\s*([\\w-]+)/i);
  const quantityMatch = text.match(/(\\d+)/);
  return {
    sku: skuMatch ? skuMatch[1] : null,
    quantity: quantityMatch ? Number(quantityMatch[1]) : null
  };
}
