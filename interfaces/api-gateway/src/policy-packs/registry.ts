import { existsSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { z } from "zod";
import { buildPackHash, buildPackSignature, buildPolicyHash, stableStringify } from "./hash";
import type { PolicyPackDetails, PolicyPackDownload, PolicyPackMetadata, PolicyPackSummary } from "./types";

const packMetadataSchema = z.object({
  name: z.string().min(1),
  version: z.string().min(1),
  description: z.string().min(1),
  createdAt: z.string().min(1),
  author: z.string().min(1)
});

const PACK_NAME_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9._-]*$/;

function resolvePolicyRoot(): string {
  const roots = [
    process.cwd(),
    path.resolve(process.cwd(), ".."),
    path.resolve(process.cwd(), "..", ".."),
    path.resolve(process.cwd(), "..", "..", "..")
  ];

  for (const candidate of roots) {
    const policyDir = path.resolve(candidate, "policies");
    if (existsSync(policyDir)) {
      return policyDir;
    }
  }

  return path.resolve(process.cwd(), "policies");
}

function resolvePacksRoot(): string {
  const policyRoot = resolvePolicyRoot();
  const configured = process.env.POLICY_PACKS_PATH;
  if (!configured) {
    return path.resolve(policyRoot, "packs");
  }
  const resolved = path.resolve(configured);
  const normalizedRoot = path.resolve(policyRoot);
  if (!resolved.startsWith(`${normalizedRoot}${path.sep}`)) {
    throw new PolicyPackError("Policy pack path must live under the policies directory.", 403);
  }
  return resolved;
}

function assertPackName(name: string): void {
  if (!PACK_NAME_PATTERN.test(name)) {
    throw new PolicyPackError("Invalid policy pack name.", 400);
  }
}

function resolvePackDir(packsRoot: string, name: string): string {
  assertPackName(name);
  const resolved = path.resolve(packsRoot, name);
  const normalizedRoot = path.resolve(packsRoot);
  if (!resolved.startsWith(`${normalizedRoot}${path.sep}`)) {
    throw new PolicyPackError("Policy pack path is outside the packs directory.", 403);
  }
  return resolved;
}

function loadJsonFile<T>(filePath: string): T {
  const raw = readFileSync(filePath, "utf-8");
  return JSON.parse(raw) as T;
}

function loadOptionalText(filePath: string): string | undefined {
  if (!existsSync(filePath)) {
    return undefined;
  }
  return readFileSync(filePath, "utf-8");
}

function loadOptionalJson(filePath: string): Record<string, unknown> | null {
  if (!existsSync(filePath)) {
    return null;
  }
  return loadJsonFile<Record<string, unknown>>(filePath);
}

function readPackMetadata(packDir: string, name: string): PolicyPackMetadata {
  const metadata = packMetadataSchema.parse(loadJsonFile<PolicyPackMetadata>(path.join(packDir, "pack.json")));
  if (metadata.name !== name) {
    throw new PolicyPackError("Pack metadata name does not match directory name.", 409);
  }
  return metadata;
}

function readPack(packDir: string, name: string) {
  const metadata = readPackMetadata(packDir, name);
  const policyYaml = readFileSync(path.join(packDir, "policy.yaml"), "utf-8");
  const notes = loadOptionalText(path.join(packDir, "notes.md"));
  const signatureFile = loadOptionalJson(path.join(packDir, "signature.json"));
  const { policy, policyHash } = buildPolicyHash(policyYaml);
  const packHash = buildPackHash({ metadata, policy, notes });
  const signature = buildPackSignature(packHash, process.env.POLICY_PACK_SIGNING_KEY);
  const signed = Boolean(signature);
  return {
    metadata,
    policy,
    policyYaml,
    notes,
    policyHash,
    packHash,
    signature,
    signatureFile,
    signed
  };
}

export class PolicyPackError extends Error {
  constructor(
    message: string,
    public readonly statusCode: number
  ) {
    super(message);
    this.name = "PolicyPackError";
  }
}

export type PolicyPackRegistry = {
  listPacks: () => PolicyPackSummary[];
  buildPackSummary: (name: string) => PolicyPackSummary;
  getPack: (name: string) => PolicyPackDetails;
  downloadPack: (name: string) => { filename: string; payload: string; metadata: PolicyPackDownload };
  getPackPath: (name: string) => string;
};

export function createPolicyPackRegistry(): PolicyPackRegistry {
  const packsRoot = resolvePacksRoot();

  const listPackNames = (): string[] => {
    if (!existsSync(packsRoot)) {
      return [];
    }
    return readdirSync(packsRoot, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .filter((name) => PACK_NAME_PATTERN.test(name))
      .sort((a, b) => a.localeCompare(b));
  };

  const buildPackSummary = (name: string): PolicyPackSummary => {
    const packDir = resolvePackDir(packsRoot, name);
    if (!existsSync(packDir)) {
      throw new PolicyPackError("Policy pack not found.", 404);
    }
    const pack = readPack(packDir, name);
    return {
      name: pack.metadata.name,
      version: pack.metadata.version,
      description: pack.metadata.description,
      createdAt: pack.metadata.createdAt,
      author: pack.metadata.author,
      policyHash: pack.policyHash,
      packHash: pack.packHash,
      signed: pack.signed
    };
  };

  return {
    listPacks: () => listPackNames().map((name) => buildPackSummary(name)),
    buildPackSummary,
    getPack: (name: string): PolicyPackDetails => {
      const packDir = resolvePackDir(packsRoot, name);
      if (!existsSync(packDir)) {
        throw new PolicyPackError("Policy pack not found.", 404);
      }
      const pack = readPack(packDir, name);
      return {
        name: pack.metadata.name,
        version: pack.metadata.version,
        description: pack.metadata.description,
        createdAt: pack.metadata.createdAt,
        author: pack.metadata.author,
        policyHash: pack.policyHash,
        packHash: pack.packHash,
        signed: pack.signed,
        policy: pack.policy,
        notes: pack.notes,
        signatureFile: pack.signatureFile,
        signature: pack.signature
      };
    },
    downloadPack: (name: string) => {
      const packDir = resolvePackDir(packsRoot, name);
      if (!existsSync(packDir)) {
        throw new PolicyPackError("Policy pack not found.", 404);
      }
      const pack = readPack(packDir, name);
      const metadata: PolicyPackDownload = {
        metadata: pack.metadata,
        policy: pack.policy,
        notes: pack.notes,
        hashes: {
          policyHash: pack.policyHash,
          packHash: pack.packHash
        },
        signature: pack.signature,
        signed: pack.signed
      };
      const payload = stableStringify(metadata);
      return {
        filename: `${pack.metadata.name}-${pack.metadata.version}.json`,
        payload,
        metadata
      };
    },
    getPackPath: (name: string): string => {
      const packDir = resolvePackDir(packsRoot, name);
      if (!existsSync(packDir)) {
        throw new PolicyPackError("Policy pack not found.", 404);
      }
      return packDir;
    }
  };
}
