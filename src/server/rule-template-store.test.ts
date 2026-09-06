import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import test from "node:test";
import type { ViewerRuleTemplateSummary, ViewerValidationConfig } from "@/features/viewer/types";

type StoredRow = {
  id: string;
  name: string;
  description: string;
  sourceKind: string;
  templateKind: string;
  sourceFileName: string | null;
  sourceText: string | null;
  config: ViewerValidationConfig;
  ruleCount: number;
  sortOrder: number;
  updatedAt: Date;
  deletedAt: Date | null;
};
type SeedData = Omit<StoredRow, "id" | "updatedAt" | "deletedAt">;

test("generated templates seed, load and download through the API while preserving user rows and deletion tombstones", async (t) => {
  // The store uses Prisma's existing delegate boundary. Supply a memory delegate before
  // importing db.ts so this exercises the real store/routes without any database connection.
  const prismaGlobal = globalThis as unknown as { prisma?: unknown };
  const previousPrisma = prismaGlobal.prisma;
  const resources = resolve(process.cwd(), "public/resources");
  const sharedConfig = JSON.parse(await readFile(resolve(resources, "industry-mapping-shared.json"), "utf8")) as ViewerValidationConfig;
  const userRow: StoredRow = {
    id: "user-existing", name: "Existing user template", description: "Keep me",
    sourceKind: "user", templateKind: "config", sourceFileName: null, sourceText: null,
    config: sharedConfig, ruleCount: 74, sortOrder: 100,
    updatedAt: new Date("2026-01-01T00:00:00Z"), deletedAt: null,
  };
  const tombstone = { ...userRow, id: "starter-structural-elements", sourceKind: "starter", deletedAt: new Date("2026-02-01T00:00:00Z") };
  const rows = new Map<string, StoredRow>([[userRow.id, userRow], [tombstone.id, tombstone]]);
  rows.set("industry-mapping-bca", {
    ...userRow, id: "industry-mapping-bca", sourceKind: "industry-mapping",
    sourceFileName: "industry-mapping-4-dec-csv.csv", sourceText: "Previously stored source",
  });
  const seededIds: string[] = [];
  prismaGlobal.prisma = {
    ruleTemplateRecord: {
      async findMany(args: { where: { id?: { in: string[] }; deletedAt?: null }; select?: unknown }) {
        const matching = [...rows.values()].filter((row) =>
          (!args.where.id || args.where.id.in.includes(row.id)) &&
          (args.where.deletedAt !== null || row.deletedAt === null),
        );
        return args.select
          ? matching.map(({ id, deletedAt }) => ({ id, deletedAt }))
          : matching.sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name));
      },
      async upsert({ where, create, update }: { where: { id: string }; create: SeedData & { id: string }; update: SeedData }) {
        seededIds.push(where.id);
        const existing = rows.get(where.id);
        const row = existing
          ? { ...existing, ...update, updatedAt: new Date() }
          : { ...create, deletedAt: null, updatedAt: new Date() };
        rows.set(where.id, row);
        return row;
      },
      async findFirst({ where }: { where: { id: string; deletedAt: null } }) {
        const row = rows.get(where.id);
        return row?.deletedAt === null ? row : null;
      },
      async updateMany({ where, data }: { where: { id: string; deletedAt: null }; data: { deletedAt: Date } }) {
        const row = rows.get(where.id);
        if (!row || row.deletedAt !== null) return { count: 0 };
        rows.set(row.id, { ...row, ...data });
        return { count: 1 };
      },
    },
  };
  t.after(() => {
    if (previousPrisma === undefined) delete prismaGlobal.prisma;
    else prismaGlobal.prisma = previousPrisma;
  });

  const store = await import("@/server/rule-template-store");
  const listRoute = await import("@/app/api/rule-templates/route");
  const itemRoute = await import("@/app/api/rule-templates/[id]/route");
  const list = await listRoute.GET();
  assert.equal(list.status, 200);
  const { templates } = await list.json() as { templates: ViewerRuleTemplateSummary[] };
  const manifest = JSON.parse(await readFile(resolve(resources, "industry-mapping-manifest.json"), "utf8")) as { id: string }[];
  const generatedIds = new Set(manifest.map((entry) => entry.id));
  const generated = templates.filter((template) => generatedIds.has(template.templateId));
  assert.equal(generated.length, 8);
  assert.ok(generated.every((template) => template.kind === "config" && template.sourceKind === "industry-mapping"));
  assert.equal(templates.at(-1)!.templateId, userRow.id);
  assert.strictEqual(rows.get(userRow.id), userRow);
  assert.strictEqual(rows.get(tombstone.id), tombstone);
  assert.ok(!seededIds.includes(tombstone.id));
  assert.ok(templates.some((template) => template.templateId === "industry-mapping-bca-column-beam"));

  for (const template of generated) {
    assert.equal(template.sourceFileName, null);
    assert.equal(rows.get(template.templateId)!.sourceText, null);
    const context = { params: Promise.resolve({ id: template.templateId }) };
    const endpoint = `http://localhost/api/rule-templates/${template.templateId}`;
    const response = await itemRoute.GET(new Request(endpoint), context);
    assert.equal(response.status, 200);
    const body = await response.json() as { template: { config: ViewerValidationConfig } };
    const file = JSON.parse(await readFile(resolve(resources, `${template.templateId}.json`), "utf8"));
    assert.deepEqual(body.template.config, file);
    assert.equal(template.ruleCount, file.clauses.reduce((sum: number, clause: { rules: unknown[] }) => sum + clause.rules.length, 0));
    assert.equal(template.clauseCount, file.clauses.length);

    const configDownload = await itemRoute.GET(new Request(`${endpoint}?format=config`), context);
    assert.equal(configDownload.status, 200);
    assert.match(configDownload.headers.get("Content-Disposition")!, new RegExp(`${template.templateId}\\.json`));
    assert.deepEqual(await configDownload.json(), file);

    const sourceDownload = await itemRoute.GET(new Request(`${endpoint}?format=source`), context);
    assert.equal(sourceDownload.status, 404);
    assert.deepEqual(await sourceDownload.json(), { error: "Rule template source not found." });
  }

  const deletedId = "industry-mapping-bca";
  assert.equal(await store.deleteRuleTemplate(deletedId), true);
  const seedCount = seededIds.filter((id) => id === deletedId).length;
  const afterDelete = await store.listRuleTemplates();
  assert.ok(!afterDelete.some((template) => template.templateId === deletedId));
  assert.equal(seededIds.filter((id) => id === deletedId).length, seedCount);
  assert.equal(await store.getRuleTemplate(deletedId), null);
  assert.equal(await store.deleteRuleTemplate(deletedId), false);
  const context = { params: Promise.resolve({ id: deletedId }) };
  for (const format of ["", "?format=config", "?format=source"]) {
    const response = await itemRoute.GET(new Request(`http://localhost/api/rule-templates/${deletedId}${format}`), context);
    assert.equal(response.status, 404);
  }
});
