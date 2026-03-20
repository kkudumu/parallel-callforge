import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import { computeCacheFingerprint, isFreshTimestamp, normalizeNiche } from "./cache-policy.js";

export type ResearchMode = "fast" | "standard" | "deep";

interface SnapshotMeta {
  agent: string;
  niche: string;
  fingerprint: string;
  createdAt: string;
  files: string[];
}

interface SnapshotBaseOptions {
  agent: string;
  niche: string;
  fingerprintInput: unknown;
}

export interface LoadResearchSnapshotOptions extends SnapshotBaseOptions {
  requiredFiles: string[];
  ttlMs: number;
  validateFile: (content: string) => boolean;
}

export interface LoadResearchSnapshotResult {
  hit: boolean;
  snapshotDir: string | null;
  reason?: string;
  validCount: number;
}

export interface SaveResearchSnapshotOptions extends SnapshotBaseOptions {
  sourceDir: string;
  files: string[];
}

export interface HydrateResearchSnapshotOptions extends SnapshotBaseOptions {
  destinationDir: string;
}

const SNAPSHOT_ROOT = path.join("tmp", "research-snapshots");

function getSnapshotDir(options: SnapshotBaseOptions): { dir: string; fingerprint: string } {
  const niche = normalizeNiche(options.niche);
  const fingerprint = computeCacheFingerprint(options.fingerprintInput);
  const dir = path.join(SNAPSHOT_ROOT, options.agent, niche, fingerprint);
  return { dir, fingerprint };
}

function readMeta(snapshotDir: string): SnapshotMeta | null {
  const metaPath = path.join(snapshotDir, "meta.json");
  if (!existsSync(metaPath)) return null;
  try {
    return JSON.parse(readFileSync(metaPath, "utf8")) as SnapshotMeta;
  } catch {
    return null;
  }
}

export function loadResearchSnapshot(
  options: LoadResearchSnapshotOptions
): LoadResearchSnapshotResult {
  const { dir } = getSnapshotDir(options);
  if (!existsSync(dir)) {
    return { hit: false, snapshotDir: null, reason: "missing_snapshot", validCount: 0 };
  }

  const meta = readMeta(dir);
  if (!meta?.createdAt || !isFreshTimestamp(meta.createdAt, options.ttlMs)) {
    return { hit: false, snapshotDir: null, reason: "stale_snapshot", validCount: 0 };
  }

  let validCount = 0;
  for (const file of options.requiredFiles) {
    const filePath = path.join(dir, file);
    if (!existsSync(filePath)) continue;
    try {
      const content = readFileSync(filePath, "utf8");
      if (options.validateFile(content)) {
        validCount += 1;
      }
    } catch {
      // Ignore individual read failures.
    }
  }

  if (validCount === 0) {
    return { hit: false, snapshotDir: null, reason: "invalid_snapshot", validCount: 0 };
  }

  return { hit: true, snapshotDir: dir, validCount };
}

export function hydrateResearchSnapshot(
  options: HydrateResearchSnapshotOptions
): { hydrated: boolean; fileCount: number } {
  const { dir } = getSnapshotDir(options);
  if (!existsSync(dir)) {
    return { hydrated: false, fileCount: 0 };
  }

  mkdirSync(options.destinationDir, { recursive: true });
  const files = readdirSync(dir).filter((name) => name.endsWith(".md"));
  let copied = 0;
  for (const file of files) {
    copyFileSync(path.join(dir, file), path.join(options.destinationDir, file));
    copied += 1;
  }
  return { hydrated: copied > 0, fileCount: copied };
}

export function saveResearchSnapshot(options: SaveResearchSnapshotOptions): void {
  const { dir, fingerprint } = getSnapshotDir(options);
  mkdirSync(dir, { recursive: true });

  const copied: string[] = [];
  for (const file of options.files) {
    const sourcePath = path.join(options.sourceDir, file);
    if (!existsSync(sourcePath)) continue;
    copyFileSync(sourcePath, path.join(dir, file));
    copied.push(file);
  }

  const meta: SnapshotMeta = {
    agent: options.agent,
    niche: normalizeNiche(options.niche),
    fingerprint,
    createdAt: new Date().toISOString(),
    files: copied,
  };
  writeFileSync(path.join(dir, "meta.json"), JSON.stringify(meta, null, 2), "utf8");
}

export function clearResearchSnapshotsForAgent(agent: string): void {
  const agentDir = path.join(SNAPSHOT_ROOT, agent);
  rmSync(agentDir, { recursive: true, force: true });
}

export function getNewestSnapshotMtimeMs(agent: string, niche: string): number | null {
  const baseDir = path.join(SNAPSHOT_ROOT, agent, normalizeNiche(niche));
  if (!existsSync(baseDir)) return null;
  let newest: number | null = null;
  for (const child of readdirSync(baseDir)) {
    const stat = statSync(path.join(baseDir, child));
    if (!newest || stat.mtimeMs > newest) {
      newest = stat.mtimeMs;
    }
  }
  return newest;
}
