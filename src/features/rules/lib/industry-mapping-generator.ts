// Offline generation only: the app loads the resulting JSON, not ExcelJS or the CSV parser.
import { createHash } from "node:crypto";
import { Readable } from "node:stream";
import ExcelJS from "exceljs";
import {
  buildViewerValidationTargetId,
  defaultViewerValidationSeverities,
  parseViewerValidationConfig,
  serializeViewerValidationConfig,
} from "@/features/rules/lib/validation";
import type {
  ViewerValidationCheck,
  ViewerValidationClause,
  ViewerValidationConfig,
  ViewerValidationRule,
  ViewerValidationTarget,
} from "@/features/viewer/types";

const AGENCIES = ["BCA", "SCDF", "URA", "NEA", "PUB", "LTA", "NParks", "All"];
const HEADERS = {
  serial: "S/N",
  agency: "Agency",
  component: "Identified Component",
  ifcType: "IFC4 Entities",
  subtype: "IFC Sub Types (* = USERDEFINED)",
  group: "Property Set",
  label: "Property Name",
  accepted: "Accepted Values (for parameters with Input Limitations)",
} as const;

type ManifestEntry = {
  id: string;
  name: string;
  description: string;
  sourceKind: "starter";
  configFileName: string;
  sourceFileName: null;
  sortOrder: number;
};

type GeneratedTemplate = { manifest: ManifestEntry; config: ViewerValidationConfig };

type SourceRecord = {
  /** One-based CSV data record, excluding the multiline header; not a physical line number. */
  record: number;
  serial: string;
  agency: string;
  component: string;
  ruleIds: string[];
  notes: string[];
};

type Overlap = {
  templateId: string;
  target: string;
  clauseTitles: string[];
  ruleIds: string[];
  differentChecks: boolean;
};

export type GeneratedIndustryMapping = {
  sourceHash: string;
  templates: GeneratedTemplate[];
  records: SourceRecord[];
  overlaps: Overlap[];
};

function normalize(value: string) {
  return value.trim().replace(/\s+/g, " ").toLowerCase();
}

function slug(value: string) {
  return normalize(value).replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

function hash(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

function compare(a: string, b: string) {
  return a < b ? -1 : a > b ? 1 : 0;
}

function absent(value: string) {
  return !value || /^n\.?a\.?$/i.test(value);
}

function concrete(value: string) {
  return !absent(value) && !/^please refer to /i.test(value);
}

function subtypes(value: string, notes: string[]): string[] {
  const tokens = value.split(",").map((part) => part.trim());
  if (normalize(value) === "all subtypes listed in cop") {
    notes.push("COP subtype list unavailable: applies to every subtype of this IFC entity.");
    return [""];
  }
  if (tokens.some(absent)) {
    if (tokens.length > 1) {
      notes.push("Mixed N.A/subtype list: applies to every subtype of this IFC entity.");
    }
    return [""];
  }
  return [...new Set(tokens.map((token) => token.replace(/^\*/, "").toUpperCase()))].sort(compare);
}

function checkFor(accepted: string, notes: string[]): ViewerValidationCheck {
  if (absent(accepted)) return { kind: "empty" };
  if (/^refer to /i.test(accepted)) {
    notes.push(`Unresolved accepted values: ${accepted}; presence check only.`);
    return { kind: "empty" };
  }
  if (normalize(accepted) === "any positive number") {
    return {
      kind: "regex",
      // The lookahead requires a nonzero significand, so 0e10 also fails.
      regex: "\\s*\\+?(?=[0-9.]*[1-9])(?:[0-9]+(?:\\.[0-9]*)?|\\.[0-9]+)(?:[eE][+-]?[0-9]+)?\\s*",
      caseInsensitive: false,
    };
  }
  if (normalize(accepted) === "true/false") {
    // Both values are allowed, using the same spellings as the runtime boolean check.
    return {
      kind: "enum",
      allowedValues: ["true", "false", "1", "0", "yes", "no", "y", "n", ".t.", ".f.", "t", "f"],
    };
  }
  const values = new Map<string, string>();
  for (const value of accepted.split(",").map((part) => part.trim()).filter(Boolean)) {
    if (!values.has(normalize(value))) values.set(normalize(value), value);
  }
  return { kind: "enum", allowedValues: [...values.values()] };
}

function checkKey(check: ViewerValidationCheck) {
  return JSON.stringify(check.kind === "enum"
    ? { kind: check.kind, allowedValues: check.allowedValues.map(normalize).sort(compare) }
    : check);
}

function ruleKey(rule: Omit<ViewerValidationRule, "id">) {
  return JSON.stringify([
    normalize(rule.ifcType), normalize(rule.subtype ?? ""),
    buildViewerValidationTargetId(rule.target), checkKey(rule.check), rule.failSeverity,
  ]);
}

/** Overlapping component clauses need review even when their checks happen to agree. */
function findOverlaps(templates: GeneratedTemplate[]): Overlap[] {
  return templates.flatMap(({ manifest, config }) => {
    const targets = new Map<string, { clause: ViewerValidationClause; rule: ViewerValidationRule }[]>();
    for (const clause of config.clauses) {
      for (const rule of clause.rules) {
        const key = `${rule.ifcType} / ${buildViewerValidationTargetId(rule.target)}`;
        const entries = targets.get(key) ?? [];
        entries.push({ clause, rule });
        targets.set(key, entries);
      }
    }
    const overlaps: Overlap[] = [];
    for (const [target, entries] of targets) {
      const scopes = [...new Set(entries.map(({ rule }) => rule.subtype ?? ""))].sort(compare);
      for (const scope of scopes) {
        const applicable = entries.filter(({ rule }) => !rule.subtype || rule.subtype === scope);
        const clauseTitles = [...new Set(applicable.map(({ clause }) => clause.title))];
        if (clauseTitles.length < 2) continue;
        overlaps.push({
          templateId: manifest.id,
          target: `${target} / ${scope || "any subtype"}`,
          clauseTitles,
          ruleIds: applicable.map(({ rule }) => rule.id),
          differentChecks: new Set(applicable.map(({ rule }) => checkKey(rule.check))).size > 1,
        });
      }
    }
    return overlaps;
  });
}

export async function generateIndustryMapping(csv: string): Promise<GeneratedIndustryMapping> {
  const workbook = new ExcelJS.Workbook();
  const sheet = await workbook.csv.read(Readable.from([csv.replace(/^\uFEFF/, "")]), {
    map: (value: string) => value,
  });
  const headerIndexes = new Map<string, number>();
  sheet.getRow(1).eachCell((cell, index) => {
    const header = normalize(String(cell.value ?? ""));
    if (!header) return; // Ignore the spreadsheet's unnamed annotation columns.
    if (headerIndexes.has(header)) throw new Error(`Duplicate CSV header: ${header}`);
    headerIndexes.set(header, index);
  });
  const columns = Object.fromEntries(Object.entries(HEADERS).map(([key, header]) => {
    const index = headerIndexes.get(normalize(header));
    if (!index) throw new Error(`Missing CSV header: ${header}`);
    return [key, index];
  })) as Record<keyof typeof HEADERS, number>;

  const groups = new Map<string, { agency: string; clause: ViewerValidationClause; rules: Map<string, ViewerValidationRule> }>();
  const records: SourceRecord[] = [];
  const allRuleIds = new Set<string>();
  for (let index = 2; index <= sheet.rowCount; index += 1) {
    const row = sheet.getRow(index);
    const value = (key: keyof typeof HEADERS) => String(row.getCell(columns[key]).value ?? "").trim();
    const agency = AGENCIES.find((candidate) => normalize(candidate) === normalize(value("agency")));
    if (!agency) throw new Error(`Unknown agency at CSV record ${index - 1}: ${value("agency")}`);
    const component = value("component");
    if (!component) throw new Error(`Missing component at CSV record ${index - 1}`);
    const record: SourceRecord = {
      record: index - 1, serial: value("serial"), agency, component, ruleIds: [], notes: [],
    };
    records.push(record);
    const group = value("group");
    const label = value("label");
    if (!concrete(label) || (!concrete(group) && !absent(group))) {
      record.notes.push("Skipped: representation/reference row without a concrete target.");
      continue;
    }
    const ifcType = value("ifcType");
    if (!/^Ifc[A-Za-z0-9]+$/.test(ifcType)) {
      throw new Error(`Invalid IFC entity at CSV record ${record.record}: ${ifcType}`);
    }
    const target: ViewerValidationTarget = absent(group)
      ? { kind: "attribute", name: label }
      : { kind: "property", group, label };
    const clauseId = `industry-${slug(agency)}-${slug(component)}`;
    let entry = groups.get(clauseId);
    if (!entry) {
      entry = { agency, clause: { id: clauseId, title: `${agency === "All" ? "Shared" : agency} - ${component}`, rules: [] }, rules: new Map() };
      groups.set(clauseId, entry);
    } else if (entry.clause.title !== `${agency === "All" ? "Shared" : agency} - ${component}`) {
      throw new Error(`Component identifier collision: ${component}`);
    }
    const check = checkFor(value("accepted"), record.notes);
    for (const subtype of subtypes(value("subtype"), record.notes)) {
      const candidate = { ifcType, ...(subtype ? { subtype } : {}), target, check, failSeverity: "error" };
      const key = ruleKey(candidate);
      let rule = entry.rules.get(key);
      if (!rule) {
        const id = `${clauseId}-${slug(label)}-${hash(key).slice(0, 12)}`;
        if (allRuleIds.has(id)) throw new Error(`Rule identifier collision: ${id}`);
        allRuleIds.add(id);
        rule = { id, ...candidate };
        entry.rules.set(key, rule);
      } else {
        record.notes.push(`Identical check deduplicated: ${rule.id}`);
      }
      record.ruleIds.push(rule.id);
    }
  }
  for (const entry of groups.values()) {
    entry.clause.rules = [...entry.rules.entries()].sort(([a], [b]) => compare(a, b)).map(([, rule]) => rule);
  }

  const templates = AGENCIES.map((agency, index): GeneratedTemplate => {
    const shared = agency === "All";
    const id = `industry-mapping-${shared ? "shared" : slug(agency)}`;
    const clauses = [...groups.values()]
      .filter((entry) => entry.agency === agency || entry.agency === "All")
      .sort((a, b) => Number(a.agency === "All") - Number(b.agency === "All") || compare(a.clause.id, b.clause.id))
      .map((entry) => entry.clause);
    const config = { version: 4 as const, severities: defaultViewerValidationSeverities(), clauses };
    // Fail generation instead of silently producing configs the importer changes or discards.
    if (JSON.stringify(parseViewerValidationConfig(config)) !== JSON.stringify(config)) {
      throw new Error(`Generated config did not round-trip unchanged: ${id}`);
    }
    return {
      manifest: {
        id,
        name: shared ? "Shared Requirements - CX Industry Mapping" : `${agency} - CX Industry Mapping`,
        description: `Manual review required. ${shared ? "Shared All-agency requirements" : `${agency} requirements, including shared All-agency clauses`} from the 4 Dec CSV. Component applicability can overlap or conflict, and referenced value lists are incomplete.`,
        sourceKind: "starter",
        configFileName: `${id}.json`,
        sourceFileName: null,
        sortOrder: 40 + index,
      },
      config,
    };
  });
  return { sourceHash: hash(csv), templates, records, overlaps: findOverlaps(templates) };
}

export function industryMappingArtifacts(result: GeneratedIndustryMapping): Map<string, string> {
  return new Map([
    ...result.templates.map(({ manifest, config }): [string, string] => [`public/resources/${manifest.configFileName}`, `${serializeViewerValidationConfig(config)}\n`]),
    ["public/resources/industry-mapping-manifest.json", `${JSON.stringify(result.templates.map(({ manifest }) => manifest), null, 2)}\n`],
  ]);
}
