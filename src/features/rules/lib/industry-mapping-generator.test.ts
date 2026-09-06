import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import test from "node:test";
import {
  generateIndustryMapping,
  industryMappingArtifacts,
  INDUSTRY_MAPPING_REVIEW_PATH,
  type GeneratedIndustryMapping,
} from "@/features/rules/lib/industry-mapping-generator";
import {
  buildViewerValidationTargetId,
  compileViewerValidationRules,
  defaultViewerValidationSeverities,
  evaluateViewerValidationPayload,
  parseViewerValidationConfigText,
} from "@/features/rules/lib/validation";
import type { ViewerInspectionValueState, ViewerValidationRule } from "@/features/viewer/types";

const resources = resolve(process.cwd(), "public/resources");
const bundled = (async () => {
  const manifest = JSON.parse(await readFile(resolve(resources, "industry-mapping-manifest.json"), "utf8")) as GeneratedIndustryMapping["templates"][number]["manifest"][];
  const templates = await Promise.all(manifest.map(async (entry) => ({
    manifest: entry,
    config: parseViewerValidationConfigText(await readFile(resolve(resources, entry.configFileName), "utf8")),
  })));
  const report = await readFile(resolve(process.cwd(), INDUSTRY_MAPPING_REVIEW_PATH), "utf8");
  const records = report.split("## Source record coverage")[1].split("\n")
    .filter((line) => /^\| \d+ \|/.test(line))
    .map((line) => ({
      ruleIds: [...line.matchAll(/`(industry-[a-z0-9-]+)`/g)].map((match) => match[1]),
      notes: [line.split("|").at(-2)!.trim()],
    }));
  return { templates, records, report };
})();

const fixtureHeaders = [
  "S/N", "Agency", "Identified Component", "IFC4\n Entities",
  "IFC Sub Types\n(* = USERDEFINED)", "Property Set", "Property Name",
  "Accepted Values \n(for parameters with Input Limitations)",
  "Sample Value for Reference", "", "",
];

type FixtureRow = {
  serial?: string; agency?: string; component?: string; entity?: string;
  subtype?: string; group?: string; label?: string; accepted?: string; sample?: string;
};

function csvFixture(rows: FixtureRow[]) {
  const quote = (value: string) => `"${value.replace(/"/g, '""')}"`;
  return `\uFEFF${[
    fixtureHeaders,
    ...rows.map((row) => [
      row.serial ?? "1", row.agency ?? "BCA", row.component ?? "Beam",
      row.entity ?? "IfcBeam", row.subtype ?? "N.A", row.group ?? "SGPset_Beam",
      row.label ?? "Value", row.accepted ?? "N.A", row.sample ?? "not a constraint",
      "check", "skip",
    ]),
  ].map((row) => row.map(quote).join(",")).join("\r\n")}\r\n`;
}

async function fixtureRules(rows: FixtureRow[], id = "industry-mapping-bca") {
  const result = await generateIndustryMapping(csvFixture(rows));
  const template = result.templates.find(({ manifest }) => manifest.id === id)!;
  return { result, rules: template.config.clauses.flatMap((clause) => clause.rules) };
}

async function passes(rule: ViewerValidationRule, text: string, state: ViewerInspectionValueState = "present") {
  const result = await evaluateViewerValidationPayload({
    version: 4, sourceId: "test", severities: defaultViewerValidationSeverities(),
    clauses: [{ id: "test", title: "Test", rules: [rule] }],
    rows: [{
      modelId: "test", localId: 1, ifcType: rule.ifcType, subtype: rule.subtype ?? null,
      values: { [buildViewerValidationTargetId(rule.target)]: { text, state } },
    }],
  });
  return result.results.length === 0;
}

test("bundled agency/shared configs are complete, runnable and traceable without the source CSV", async () => {
  const result = await bundled;
  assert.equal(result.records.length, 833);
  assert.equal(result.records.filter((record) => record.ruleIds.length > 0).length, 671);
  assert.equal(result.records.filter((record) => record.ruleIds.length === 0).length, 162);
  assert.deepEqual(result.templates.map(({ manifest, config }) => [
    manifest.id, config.clauses.length, config.clauses.reduce((sum, clause) => sum + clause.rules.length, 0),
  ]), [
    ["industry-mapping-bca", 31, 418], ["industry-mapping-scdf", 23, 166],
    ["industry-mapping-ura", 11, 104], ["industry-mapping-nea", 19, 439],
    ["industry-mapping-pub", 23, 495], ["industry-mapping-lta", 11, 158],
    ["industry-mapping-nparks", 12, 132], ["industry-mapping-shared", 5, 74],
  ]);
  const shared = result.templates.at(-1)!.config.clauses;
  const referenced = new Set(result.records.flatMap((record) => record.ruleIds));
  const emitted = new Set<string>();
  for (const { manifest, config } of result.templates) {
    assert.equal(manifest.sourceFileName, null);
    assert.equal(manifest.sourceKind, "industry-mapping");
    assert.match(manifest.description, /^Manual review required\./);
    assert.ok(result.report.includes(`](/resources/${manifest.configFileName})`));
    const rules = config.clauses.flatMap((clause) => clause.rules);
    assert.equal(new Set(rules.map((rule) => rule.id)).size, rules.length);
    let compiledCount = 0;
    for (const targets of compileViewerValidationRules(config.clauses).values()) {
      for (const checks of targets.values()) compiledCount += checks.length;
    }
    assert.equal(compiledCount, rules.length);
    assert.deepEqual(config.clauses.filter((clause) => clause.id.startsWith("industry-all-")), shared);
    for (const rule of rules) {
      emitted.add(rule.id);
      assert.ok(referenced.has(rule.id), `Missing source for ${rule.id}`);
      assert.equal(rule.failSeverity, "error");
    }
  }
  assert.deepEqual(emitted, referenced);
});

test("generation is reproducible with synthetic input and never adds a source download", async () => {
  const csv = csvFixture([{ component: "Beam <tag> {review} & checks", accepted: "First, Second" }, { label: "Other", subtype: "*CUSTOM" }]);
  const artifacts = industryMappingArtifacts(await generateIndustryMapping(csv));
  assert.deepEqual(artifacts, industryMappingArtifacts(await generateIndustryMapping(csv)));
  for (const [name, text] of artifacts) {
    if (name.endsWith(".json") && !name.includes("manifest")) {
      assert.deepEqual(parseViewerValidationConfigText(text), JSON.parse(text));
    }
  }
  assert.ok(![...artifacts.keys()].some((name) => name.endsWith(".csv")));
  assert.ok(JSON.parse(artifacts.get("public/resources/industry-mapping-manifest.json")!).every((entry: { sourceFileName: unknown }) => entry.sourceFileName === null));
  const report = artifacts.get(INDUSTRY_MAPPING_REVIEW_PATH)!;
  assert.match(report, /^---\ntitle: Industry mapping review notes\n/);
  assert.match(report, /source CSV is not distributed/);
  assert.ok(report.includes("Beam &#60;tag&#62; &#123;review&#125; &amp; checks"));
  assert.ok(![...artifacts.keys()].some((name) => name.startsWith("public/") && !name.endsWith(".json")));
});

test("CSV parsing handles BOM, multiline headers, quotes and commas without using sample/annotation values", async () => {
  const { result, rules } = await fixtureRules([
    { component: 'Beam, "special"', label: "Allowed", accepted: 'Single, End, A "quoted" value' },
    { component: 'Beam, "special"', label: "Reference", sample: "1500, 1800" },
  ]);
  assert.equal(result.records[0].component, 'Beam, "special"');
  const allowed = rules.find((rule) => rule.target.kind === "property" && rule.target.label === "Allowed")!;
  assert.deepEqual(allowed.check, { kind: "enum", allowedValues: ["Single", "End", 'A "quoted" value'] });
  assert.equal(await passes(allowed, " end "), true);
  assert.equal(await passes(allowed, "Outside"), false);
  const required = rules.find((rule) => rule.target.kind === "property" && rule.target.label === "Reference")!;
  assert.deepEqual(required.check, { kind: "empty" });
  assert.equal(await passes(required, "anything"), true);
  for (const state of ["missing", "empty", "null", "undefined"] as const) {
    assert.equal(await passes(required, "", state), false);
    assert.equal(await passes(allowed, "", state), false);
  }
});

test("both boolean values use the evaluator's supported spellings; unknown values fail", async () => {
  const { rules: [rule] } = await fixtureRules([{ accepted: "TRUE/FALSE" }]);
  for (const token of ["TRUE", "false", "1", "0", "yes", "no", "y", "n", ".T.", ".F.", "t", "f"]) {
    assert.equal(await passes(rule, token), true, token);
  }
  for (const token of ["perhaps", "2", "TRUE/FALSE"]) assert.equal(await passes(rule, token), false, token);
});

test("positive-number checks accept positive decimal/scientific text and reject zero, negatives and invalid text", async () => {
  const { rules: [rule] } = await fixtureRules([{ accepted: "Any positive number" }]);
  assert.equal(rule.check.kind, "regex");
  for (const token of ["1", "0.01", ".5", "+2.0", "1e-6", "2E+3", "000.001", " 15 "]) {
    assert.equal(await passes(rule, token), true, token);
  }
  for (const token of ["0", "0.00", "0e10", "+0", "-2", "NaN", "Infinity", "10mm", "1.2.3", ""]) {
    assert.equal(await passes(rule, token), false, token);
  }
});

test("subtype expansion preserves scope and records broad N.A/COP interpretations", async () => {
  const { result, rules } = await fixtureRules([
    { subtype: "DOOR, *BLASTDOOR, DOOR", entity: "IfcDoor", label: "Specific" },
    { subtype: "N.A, FLOOR, LANDING", entity: "IfcSlab", label: "Mixed" },
    { subtype: "All subtypes listed in COP", entity: "IfcWindow", label: "COP" },
  ]);
  assert.deepEqual(rules.filter((rule) => rule.ifcType === "IfcDoor").map((rule) => rule.subtype), ["BLASTDOOR", "DOOR"]);
  assert.equal(rules.filter((rule) => !rule.subtype).length, 2);
  assert.match(result.records[1].notes.join(" "), /Mixed N.A/);
  assert.match(result.records[2].notes.join(" "), /COP subtype list unavailable/);
  const specific = rules.filter((rule) => rule.ifcType === "IfcDoor");
  const evaluated = await evaluateViewerValidationPayload({
    version: 4, sourceId: "test", severities: defaultViewerValidationSeverities(),
    clauses: [{ id: "scope", title: "Scope", rules: specific }],
    rows: ["BLASTDOOR", "DOOR", "GATE", null].map((subtype, localId) => ({
      modelId: "test", localId, ifcType: "IfcDoor", subtype, values: {},
    })),
  });
  assert.deepEqual(evaluated.results.map((entry) => entry.localId), [0, 1]);
});

test("agency casing, attribute targets, repeated S/N and semantic deduplication preserve all source records", async () => {
  const rows: FixtureRow[] = [
    { serial: "609", label: "First" }, { serial: "609", label: "Second" },
    { serial: "700", label: "First" },
    { agency: "NPARKS", component: "Plant", label: " Height " },
    { agency: "NParks", component: "Plant", label: "Width" },
    { agency: "All", component: "Block Name", entity: "IfcSite", group: "N.A", label: "Name" },
  ];
  const { result, rules } = await fixtureRules(rows);
  assert.equal(rules.length, 3); // First, Second, shared Name.
  assert.deepEqual(result.records[0].ruleIds, result.records[2].ruleIds);
  assert.notDeepEqual(result.records[0].ruleIds, result.records[1].ruleIds);
  assert.match(result.records[2].notes.join(" "), /deduplicated/);
  assert.deepEqual(rules.find((rule) => rule.ifcType === "IfcSite")!.target, { kind: "attribute", name: "Name" });
  const parks = result.templates.find(({ manifest }) => manifest.id === "industry-mapping-nparks")!;
  assert.equal(parks.config.clauses.length, 2);
  assert.ok(parks.config.clauses.flatMap((clause) => clause.rules).some((rule) => rule.target.kind === "property" && rule.target.label === "Height"));
  const reversed = await generateIndustryMapping(csvFixture([...rows].reverse()));
  assert.deepEqual(result.templates, reversed.templates, "Config IDs and ordering must survive source reordering");
});

test("missing external lists and component conflicts remain visible for manual review", async () => {
  const result = await bundled;
  const unresolved = result.records.filter((record) => record.notes.some((note) => note.startsWith("Unresolved accepted values")));
  assert.equal(unresolved.length, 10);
  const rules = new Map(result.templates.flatMap(({ config }) => config.clauses.flatMap((clause) => clause.rules)).map((rule) => [rule.id, rule]));
  for (const record of unresolved) {
    for (const id of record.ruleIds) assert.deepEqual(rules.get(id)!.check, { kind: "empty" });
  }
  const conflict = result.report.split("\n").find((line) => line.startsWith("| industry-mapping-bca | IfcSpace / property:sgpset_space::spacename / SPACE |"));
  assert.ok(conflict?.includes("Different — review for conflicts"));
  for (const title of ["BCA - Household Shelter", "BCA - Refuse Chute / Recyclables Chute", "BCA - Staircase", "Shared - Space (Usage)"]) {
    assert.ok(conflict.includes(title));
  }
});

test("malformed headers and unknown agencies stop generation instead of producing partial coverage", async () => {
  await assert.rejects(generateIndustryMapping(csvFixture([{}]).replace('"Property Name"', '"Missing"')), /Missing CSV header: Property Name/);
  await assert.rejects(generateIndustryMapping(csvFixture([{ agency: "Unrecognized" }])), /Unknown agency at CSV record 1/);
});
