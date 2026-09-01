import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { realpath, stat } from "node:fs/promises";
import { basename, relative, resolve } from "node:path";

export interface KnowledgeByteRange {
  start: number;
  end: number;
}

export function parseKnowledgeByteRange(
  value: string | null,
  size: number,
): KnowledgeByteRange | null | "invalid" {
  if (!value) return null;
  const match = /^bytes=(\d*)-(\d*)$/.exec(value.trim());
  if (!match || (!match[1] && !match[2])) return "invalid";
  let start: number;
  let end: number;
  if (!match[1]) {
    const suffix = Number(match[2]);
    if (!Number.isSafeInteger(suffix) || suffix <= 0) return "invalid";
    start = Math.max(0, size - suffix);
    end = size - 1;
  } else {
    start = Number(match[1]);
    end = match[2] ? Number(match[2]) : size - 1;
  }
  if (
    !Number.isSafeInteger(start) ||
    !Number.isSafeInteger(end) ||
    start < 0 ||
    start >= size ||
    end < start
  ) {
    return "invalid";
  }
  return { start, end: Math.min(end, size - 1) };
}

export function knowledgeEtagMatches(value: string | null, etag: string) {
  if (!value) return false;
  return value
    .split(",")
    .some((candidate) => candidate.trim() === "*" || candidate.trim() === etag);
}

export function requestedKnowledgeByteRange(
  rangeHeader: string | null,
  ifRangeHeader: string | null,
  etag: string,
  size: number,
) {
  if (ifRangeHeader && ifRangeHeader.trim() !== etag) return null;
  return parseKnowledgeByteRange(rangeHeader, size);
}

const verified = new Map<string, Promise<boolean>>();

async function verifyHash(path: string, expected: string) {
  const details = await stat(path);
  const key = `${path}:${details.size}:${details.mtimeMs}:${expected}`;
  let result = verified.get(key);
  if (!result) {
    result = new Promise<boolean>((resolveResult, reject) => {
      const hash = createHash("sha256");
      const stream = createReadStream(path);
      stream.on("data", (chunk) => hash.update(chunk));
      stream.on("error", reject);
      stream.on("end", () => resolveResult(hash.digest("hex") === expected));
    });
    verified.set(key, result);
  }
  return result;
}

export async function verifiedKnowledgeSourceFile(filename: string, sha256: string) {
  if (basename(filename) !== filename || !filename.toLocaleLowerCase().endsWith(".pdf")) {
    throw new Error("Unsupported knowledge source file.");
  }
  const root = await realpath(resolve(process.cwd(), "docs/official-cx"));
  const path = await realpath(resolve(root, filename));
  const pathFromRoot = relative(root, path);
  if (pathFromRoot.startsWith("..") || pathFromRoot.includes("/../")) {
    throw new Error("Knowledge source path is outside the configured directory.");
  }
  const details = await stat(path);
  if (!(await verifyHash(path, sha256))) throw new Error("Knowledge source file hash mismatch.");
  return { path, size: details.size };
}
