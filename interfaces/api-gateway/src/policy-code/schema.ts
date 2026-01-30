import { z } from "zod";
import { intentTypeSchema } from "../intent/intent-model";

const autoRequirementSchema = z.enum(["WARN", "ALLOW_ONLY"]);
const executionModeSchema = z.enum(["manual", "auto", "simulate"]);

const confidenceConstraintSchema = z.object({
  type: z.literal("CONFIDENCE_MIN"),
  params: z.object({
    min: z.number().min(0).max(1)
  })
});

const maxAmountConstraintSchema = z.object({
  type: z.literal("MAX_AMOUNT"),
  params: z.object({
    max: z.number().positive()
  })
});

const skuBlocklistConstraintSchema = z.object({
  type: z.literal("SKU_BLOCKLIST"),
  params: z.object({
    skus: z.array(z.string().min(1)).min(1)
  })
});

const vendorBlocklistConstraintSchema = z.object({
  type: z.literal("VENDOR_BLOCKLIST"),
  params: z.object({
    vendors: z.array(z.string().min(1)).min(1)
  })
});

const executionModeConstraintSchema = z.object({
  type: z.literal("EXECUTION_MODE"),
  params: z.object({
    mode: executionModeSchema
  })
});

const rateLimitConstraintSchema = z.object({
  type: z.literal("RATE_LIMIT"),
  params: z.object({
    windowSeconds: z.number().int().positive(),
    max: z.number().int().positive()
  })
});

const constraintSchema = z.discriminatedUnion("type", [
  confidenceConstraintSchema,
  maxAmountConstraintSchema,
  skuBlocklistConstraintSchema,
  vendorBlocklistConstraintSchema,
  executionModeConstraintSchema,
  rateLimitConstraintSchema
]);

const policyRuleSchema = z.object({
  id: z.string().min(1),
  enabled: z.boolean(),
  priority: z.number().int(),
  appliesTo: z.object({
    intentTypes: z.array(intentTypeSchema).min(1)
  }),
  constraints: z.array(constraintSchema),
  decision: z.enum(["ALLOW", "WARN", "DENY"]),
  reason: z.string().min(1),
  tags: z.array(z.string().min(1)).default([])
});

const policyDefaultsSchema = z.object({
  confidenceThreshold: z.number().min(0).max(1),
  execution: z.object({
    autoRequires: z.array(autoRequirementSchema).default([])
  })
});

export const policyDocumentSchema = z.object({
  version: z.literal("v1"),
  defaults: policyDefaultsSchema,
  rules: z.array(policyRuleSchema)
});

export type PolicyDocumentSchema = z.infer<typeof policyDocumentSchema>;
