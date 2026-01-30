import { z } from "zod";

export const intentTypeSchema = z.enum(["CREATE_PO", "CHECK_INVENTORY", "REVIEW_INVOICE"]);

export const intentSchema = z.object({
  intentType: intentTypeSchema,
  entities: z
    .object({
      sku: z.string().optional(),
      quantity: z.number().optional(),
      vendor: z.string().optional(),
      invoiceId: z.string().optional()
    })
    .default({}),
  confidence: z.number().min(0).max(1),
  rawText: z.string().min(1)
});

export type Intent = z.infer<typeof intentSchema>;
