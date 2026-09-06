import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import {
  generateIndustryMapping,
  industryMappingArtifacts,
} from "../src/features/rules/lib/industry-mapping-generator";

async function main() {
  const args = process.argv.slice(2);
  let sourcePath: string | undefined;
  let check = false;
  for (let index = 0; index < args.length; index += 1) {
    if (args[index] === "--check") {
      check = true;
    } else if (args[index] === "--source" && args[index + 1] && !args[index + 1].startsWith("--") && !sourcePath) {
      sourcePath = args[++index];
    } else {
      throw new Error("Usage: pnpm templates:generate --source /path/to/mapping.csv [--check]");
    }
  }
  if (!sourcePath) {
    throw new Error("The source CSV is not bundled. Supply it with --source /path/to/mapping.csv.");
  }
  const root = resolve(import.meta.dirname, "..");
  const source = await readFile(resolve(sourcePath), "utf8");
  const generated = await generateIndustryMapping(source);
  const artifacts = industryMappingArtifacts(generated);
  const stale: string[] = [];
  for (const [fileName, contents] of artifacts) {
    const path = resolve(root, fileName);
    if (check) {
      const existing = await readFile(path, "utf8").catch((error: NodeJS.ErrnoException) => {
        if (error.code === "ENOENT") return null;
        throw error;
      });
      if (existing !== contents) stale.push(fileName);
    } else {
      await writeFile(path, contents, "utf8");
    }
  }
  if (stale.length) {
    throw new Error(`Generated templates are stale: ${stale.join(", ")}. Regenerate with the same --source file.`);
  }
  console.log(`${check ? "Verified" : "Generated"} ${generated.templates.length} templates and their manifest from ${generated.records.length} CSV records.`);
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
