import { Intent, intentSchema } from "./intent-model";

const skuPattern = /\bsku[:\s-]*([A-Z0-9-]+)\b/i;
const quantityPattern = /\b(\d+)\s*(units|unit|qty|quantity)?\b/i;
const invoicePattern = /\binvoice[:\s-]*([A-Z0-9-]+)\b/i;
const vendorPattern = /\bvendor[:\s-]*([A-Z0-9-]+)\b/i;
const amountPattern = /\bamount[:\s-]*([\d.]+)\b/i;

function parseEntities(text: string): Intent["entities"] {
  const entities: Intent["entities"] = {};
  const skuMatch = text.match(skuPattern);
  if (skuMatch?.[1]) {
    entities.sku = skuMatch[1];
  }
  const qtyMatch = text.match(quantityPattern);
  if (qtyMatch?.[1]) {
    entities.quantity = Number(qtyMatch[1]);
  }
  const invoiceMatch = text.match(invoicePattern);
  if (invoiceMatch?.[1]) {
    entities.invoiceId = invoiceMatch[1];
  }
  const vendorMatch = text.match(vendorPattern);
  if (vendorMatch?.[1]) {
    entities.vendor = vendorMatch[1];
  }
  const amountMatch = text.match(amountPattern);
  if (amountMatch?.[1]) {
    entities.amount = Number(amountMatch[1]);
  }
  return entities;
}

export function parseIntent(text: string): Intent {
  const lowered = text.toLowerCase();
  const entities = parseEntities(text);

  if (lowered.includes("invoice")) {
    return intentSchema.parse({
      intentType: "REVIEW_INVOICE",
      entities,
      confidence: 0.78,
      rawText: text
    });
  }

  if (lowered.includes("inventory") || lowered.includes("stock")) {
    return intentSchema.parse({
      intentType: "CHECK_INVENTORY",
      entities,
      confidence: 0.74,
      rawText: text
    });
  }

  if (lowered.includes("order") || lowered.includes("po") || lowered.includes("purchase order")) {
    return intentSchema.parse({
      intentType: "CREATE_PO",
      entities,
      confidence: 0.8,
      rawText: text
    });
  }

  return intentSchema.parse({
    intentType: "CHECK_INVENTORY",
    entities,
    confidence: 0.4,
    rawText: text
  });
}
