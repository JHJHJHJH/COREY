import assert from "node:assert/strict";
import test from "node:test";
import type {
  ViewerValidationClause,
  ViewerValidationRow,
  ViewerValidationValue,
} from "@/features/viewer/types";
import {
  buildViewerValidationRuleKey,
  cloneViewerValidationClauses,
  countViewerValidationRulesBySeverity,
  defaultViewerValidationSeverities,
  evaluateViewerValidationPayload,
  groupViewerValidationResultsBySeverity,
  mergeViewerValidationSeverities,
  parseStoredViewerValidationConfigText,
  parseViewerValidationConfigText,
  resolveIfcSubtype,
  serializeViewerValidationConfig,
} from "@/features/rules/lib/validation";

function present(text: string): ViewerValidationValue {
  return { text, state: "present" };
}

function missing(): ViewerValidationValue {
  return { text: "", state: "missing" };
}

function row(
  localId: number,
  ifcType: string,
  subtype: string | null,
  values: Record<string, ViewerValidationValue> = {},
): ViewerValidationRow {
  return { modelId: "model", localId, ifcType, subtype, values };
}

/** Fails whenever the element's Name is absent, so applicability is what each test isolates. */
function nameRequiredClause(
  clauseId: string,
  ruleId: string,
  ifcType: string,
  subtype?: string,
): ViewerValidationClause {
  return {
    id: clauseId,
    title: clauseId,
    rules: [
      {
        id: ruleId,
        ifcType,
        ...(subtype === undefined ? {} : { subtype }),
        target: { kind: "attribute", name: "Name" },
        check: { kind: "empty" },
        failSeverity: "error",
      },
    ],
  };
}

async function evaluate(clauses: ViewerValidationClause[], rows: ViewerValidationRow[]) {
  return evaluateViewerValidationPayload({
    version: 4,
    sourceId: "test",
    severities: defaultViewerValidationSeverities(),
    clauses,
    rows,
  });
}

function failedRuleIds(
  result: Awaited<ReturnType<typeof evaluateViewerValidationPayload>>,
  localId: number,
) {
  const elementResult = result.results.find((entry) => entry.localId === localId);
  return elementResult?.failedClauses.map((failure) => failure.clauseId).sort() ?? [];
}

const nameMissing = { "attribute:name": missing() };

test("a rule without a subtype still applies to every element of its IFC type", async () => {
  const result = await evaluate(
    [nameRequiredClause("any-slab", "rule-any", "IfcSlab")],
    [
      row(1, "IFCSLAB", "FLOOR", nameMissing),
      row(2, "IFCSLAB", "ROOF", nameMissing),
      row(3, "IFCSLAB", null, nameMissing),
    ],
  );

  assert.deepEqual(
    result.results.map((entry) => entry.localId).sort(),
    [1, 2, 3],
  );
});

test("a subtype rule applies only to matching elements and leaves the rest unevaluated", async () => {
  const result = await evaluate(
    [nameRequiredClause("floor-slab", "rule-floor", "IfcSlab", "FLOOR")],
    [row(1, "IFCSLAB", "FLOOR", nameMissing), row(2, "IFCSLAB", "ROOF", nameMissing)],
  );

  // The roof slab is a non-match, not a failure — it must be absent from the results entirely.
  assert.deepEqual(
    result.results.map((entry) => entry.localId),
    [1],
  );
});

test("subtype matching ignores case and surrounding whitespace", async () => {
  const result = await evaluate(
    [nameRequiredClause("floor-slab", "rule-floor", "IfcSlab", "  floor ")],
    [row(1, "IFCSLAB", "FLOOR", nameMissing)],
  );

  assert.equal(result.results.length, 1);
});

test("an element without a subtype is matched only by rules that omit the subtype", async () => {
  const result = await evaluate(
    [
      nameRequiredClause("any-slab", "rule-any", "IfcSlab"),
      nameRequiredClause("floor-slab", "rule-floor", "IfcSlab", "FLOOR"),
    ],
    [row(1, "IFCSLAB", null, nameMissing)],
  );

  assert.deepEqual(failedRuleIds(result, 1), ["any-slab"]);
});

test("subtype and any-subtype rules on the same type and target both fire", async () => {
  const result = await evaluate(
    [
      nameRequiredClause("any-slab", "rule-any", "IfcSlab"),
      nameRequiredClause("floor-slab", "rule-floor", "IfcSlab", "FLOOR"),
    ],
    [row(1, "IFCSLAB", "FLOOR", nameMissing)],
  );

  assert.deepEqual(failedRuleIds(result, 1), ["any-slab", "floor-slab"]);
});

test("a matched subtype rule evaluates its check rather than passing by default", async () => {
  const result = await evaluate(
    [nameRequiredClause("floor-slab", "rule-floor", "IfcSlab", "FLOOR")],
    [row(1, "IFCSLAB", "FLOOR", { "attribute:name": present("Slab A") })],
  );

  assert.deepEqual(result.results, []);
});

test("resolveIfcSubtype falls back to ObjectType for USERDEFINED predefined types", () => {
  assert.equal(resolveIfcSubtype("FLOOR", "Ignored"), "FLOOR");
  assert.equal(resolveIfcSubtype("USERDEFINED", "SG-Floor-A"), "SG-Floor-A");
  assert.equal(resolveIfcSubtype("userdefined", "  SG-Floor-A  "), "SG-Floor-A");
  // No ObjectType to fall back to, so the literal USERDEFINED is still matchable.
  assert.equal(resolveIfcSubtype("USERDEFINED", null), "USERDEFINED");
  assert.equal(resolveIfcSubtype(null, "SG-Floor-A"), "SG-Floor-A");
  assert.equal(resolveIfcSubtype(null, null), null);
  assert.equal(resolveIfcSubtype("", "   "), null);
});

test("rule keys distinguish rules that differ only by subtype", () => {
  const target = { kind: "attribute", name: "Name" } as const;

  assert.notEqual(
    buildViewerValidationRuleKey({ ifcType: "IfcSlab", subtype: "FLOOR", target }),
    buildViewerValidationRuleKey({ ifcType: "IfcSlab", target }),
  );
  assert.equal(
    buildViewerValidationRuleKey({ ifcType: "IfcSlab", subtype: "", target }),
    buildViewerValidationRuleKey({ ifcType: "IfcSlab", target }),
  );
});

test("configs authored without a subtype round-trip unchanged", () => {
  const source = {
    version: 4,
    severities: defaultViewerValidationSeverities(),
    clauses: [
      {
        id: "clause-1",
        title: "Wall basics",
        rules: [
          {
            id: "rule-1",
            ifcType: "IfcWall",
            target: { kind: "attribute", name: "Name" },
            check: { kind: "empty" },
            failSeverity: "error",
          },
        ],
      },
    ],
  };

  const roundTripped = JSON.parse(
    serializeViewerValidationConfig(parseViewerValidationConfigText(JSON.stringify(source))),
  );

  assert.deepEqual(roundTripped, source);
  assert.equal("subtype" in roundTripped.clauses[0].rules[0], false);
});

test("a blank subtype is dropped on serialization and a set one is preserved", () => {
  const config = parseViewerValidationConfigText(
    JSON.stringify({
      version: 4,
      severities: defaultViewerValidationSeverities(),
      clauses: [
        {
          id: "clause-1",
          title: "Slab basics",
          rules: [
            {
              id: "rule-blank",
              ifcType: "IfcSlab",
              subtype: "   ",
              target: { kind: "attribute", name: "Name" },
              check: { kind: "empty" },
              failSeverity: "error",
            },
            {
              id: "rule-floor",
              ifcType: "IfcSlab",
              subtype: "  FLOOR  ",
              target: { kind: "attribute", name: "Name" },
              check: { kind: "empty" },
              failSeverity: "error",
            },
          ],
        },
      ],
    }),
  );

  const rules = JSON.parse(serializeViewerValidationConfig(config)).clauses[0].rules;
  assert.equal("subtype" in rules[0], false);
  assert.equal(rules[1].subtype, "FLOOR");
});

test("version 2 pattern checks migrate to version 4 regex checks", () => {
  const config = parseViewerValidationConfigText(
    JSON.stringify({
      version: 2,
      clauses: [
        {
          id: "clause-1",
          title: "Identity",
          rules: [
            {
              id: "rule-1",
              ifcType: "IfcWall",
              target: { kind: "attribute", name: "GlobalId" },
              check: {
                kind: "pattern",
                pattern: "[0-9A-Za-z_$]{22}",
                caseInsensitive: false,
              },
              failSeverity: "error",
            },
          ],
        },
      ],
    }),
  );

  assert.equal(config.version, 4);
  assert.deepEqual(config.severities, defaultViewerValidationSeverities());
  assert.deepEqual(config.clauses[0]?.rules[0]?.check, {
    kind: "regex",
    regex: "[0-9A-Za-z_$]{22}",
    caseInsensitive: false,
  });
  assert.equal(serializeViewerValidationConfig(config).includes('"pattern"'), false);
});

test("stored version 1 pattern checks migrate through to regex checks", () => {
  const config = parseStoredViewerValidationConfigText(
    JSON.stringify({
      version: 1,
      rules: [
        {
          id: "rule-1",
          ifcType: "IfcWall",
          target: { kind: "attribute", name: "Name" },
          check: { kind: "pattern", pattern: "Wall .+", caseInsensitive: true },
          failSeverity: "warn",
        },
      ],
    }),
  );

  assert.equal(config.version, 4);
  assert.deepEqual(config.severities, defaultViewerValidationSeverities());
  assert.deepEqual(config.clauses[0]?.rules[0]?.check, {
    kind: "regex",
    regex: "Wall .+",
    caseInsensitive: true,
  });
});

test("regex checks match the whole value and honor case-insensitive mode", async () => {
  const clause: ViewerValidationClause = {
    id: "codes",
    title: "Codes",
    rules: [
      {
        id: "code-format",
        ifcType: "IfcWall",
        target: { kind: "attribute", name: "Name" },
        check: { kind: "regex", regex: "ec\\d{3}", caseInsensitive: true },
        failSeverity: "error",
      },
    ],
  };

  const matching = await evaluate(
    [clause],
    [row(1, "IFCWALL", null, { "attribute:name": present("EC123") })],
  );
  const partial = await evaluate(
    [clause],
    [row(2, "IFCWALL", null, { "attribute:name": present("XEC123") })],
  );

  assert.deepEqual(matching.results, []);
  assert.equal(partial.results[0]?.localId, 2);
});

test("blank or invalid regex checks remain stored but are not runnable", async () => {
  const result = await evaluate(
    [
      {
        id: "invalid-regex",
        title: "Invalid regex",
        rules: [
          {
            id: "invalid",
            ifcType: "IfcWall",
            target: { kind: "attribute", name: "Name" },
            check: { kind: "regex", regex: "[", caseInsensitive: false },
            failSeverity: "error",
          },
        ],
      },
    ],
    [row(1, "IFCWALL", null, { "attribute:name": present("Wall") })],
  );

  assert.deepEqual(result.results, []);
});

/* ------------------------------------------------------------------ */
/* Configurable severities                                              */
/* ------------------------------------------------------------------ */

const threeLevelSeverities = [
  { id: "info", label: "Info", color: "#6b7280", order: 1 },
  { id: "major", label: "Major", color: "#e07a1f", order: 2 },
  { id: "critical", label: "Critical", color: "#bb5a36", order: 3 },
];

function severityClause(clauseId: string, ruleId: string, failSeverity: string, attribute: string) {
  return {
    id: clauseId,
    title: clauseId,
    rules: [
      {
        id: ruleId,
        ifcType: "IfcWall",
        target: { kind: "attribute" as const, name: attribute },
        check: { kind: "empty" as const },
        failSeverity,
      },
    ],
  };
}

test("version 3 configs migrate to version 4 with the seeded severities", () => {
  const config = parseViewerValidationConfigText(
    JSON.stringify({
      version: 3,
      clauses: [
        {
          id: "clause-1",
          title: "Wall basics",
          rules: [
            {
              id: "rule-1",
              ifcType: "IfcWall",
              target: { kind: "attribute", name: "Name" },
              check: { kind: "empty" },
              failSeverity: "warn",
            },
          ],
        },
      ],
    }),
  );

  assert.equal(config.version, 4);
  assert.deepEqual(config.severities, defaultViewerValidationSeverities());
  assert.equal(config.clauses[0]?.rules[0]?.failSeverity, "warn");
});

test("the severity list is normalized: reserved ids, duplicates and bad colours are dropped", () => {
  const config = parseViewerValidationConfigText(
    JSON.stringify({
      version: 4,
      severities: [
        { id: "ok", label: "Reserved", color: "#123456", order: 1 },
        { id: "Minor Issue", label: "Minor", color: "#AABBCC", order: 5 },
        { id: "minor-issue", label: "Duplicate", color: "#000000", order: 6 },
        { id: "major", label: "", color: "not-a-colour", order: 2 },
      ],
      clauses: [],
    }),
  );

  // "ok" is reserved, and the slugified "Minor Issue" collides with the explicit "minor-issue".
  assert.deepEqual(
    config.severities.map((severity) => severity.id),
    ["major", "minor-issue"],
  );
  // Order is densified from the sorted input, and a blank label falls back to the id.
  assert.deepEqual(
    config.severities.map((severity) => severity.order),
    [1, 2],
  );
  assert.equal(config.severities[0]?.label, "major");
  assert.equal(config.severities[1]?.color, "#aabbcc");
});

test("a rule naming an unconfigured severity is remapped to the most severe level", () => {
  const config = parseViewerValidationConfigText(
    JSON.stringify({
      version: 4,
      severities: threeLevelSeverities,
      clauses: [severityClause("clause-1", "rule-1", "does-not-exist", "Name")],
    }),
  );

  // Never a silent downgrade: an unknown id lands on the highest-order severity.
  assert.equal(config.clauses[0]?.rules[0]?.failSeverity, "critical");
});

test("an empty severity list falls back to the seeded defaults", () => {
  const config = parseViewerValidationConfigText(
    JSON.stringify({ version: 4, severities: [], clauses: [] }),
  );

  assert.deepEqual(config.severities, defaultViewerValidationSeverities());
});

test("element results roll up to the highest-order severity across several failures", async () => {
  const result = await evaluateViewerValidationPayload({
    version: 4,
    sourceId: "test",
    severities: threeLevelSeverities,
    clauses: [
      severityClause("info-clause", "info-rule", "info", "Name"),
      severityClause("critical-clause", "critical-rule", "critical", "Description"),
      severityClause("major-clause", "major-rule", "major", "Tag"),
    ],
    rows: [
      row(1, "IFCWALL", null, {
        "attribute:name": missing(),
        "attribute:description": missing(),
        "attribute:tag": missing(),
      }),
    ],
  });

  const element = result.results.find((entry) => entry.localId === 1);
  assert.equal(element?.result, "critical");
  // The individual rule failures keep their own severities, which is what the filters read.
  assert.deepEqual(
    element?.failedClauses.map((clause) => clause.result).sort(),
    ["critical", "info", "major"],
  );
});

test("reordering severities changes which one wins the rollup", async () => {
  const promoted = [
    { id: "info", label: "Info", color: "#6b7280", order: 3 },
    { id: "major", label: "Major", color: "#e07a1f", order: 2 },
    { id: "critical", label: "Critical", color: "#bb5a36", order: 1 },
  ];

  const result = await evaluateViewerValidationPayload({
    version: 4,
    sourceId: "test",
    severities: promoted,
    clauses: [
      severityClause("info-clause", "info-rule", "info", "Name"),
      severityClause("critical-clause", "critical-rule", "critical", "Description"),
    ],
    rows: [
      row(1, "IFCWALL", null, {
        "attribute:name": missing(),
        "attribute:description": missing(),
      }),
    ],
  });

  // "info" now outranks "critical", so it takes the element's colour.
  assert.equal(result.results.find((entry) => entry.localId === 1)?.result, "info");
});

test("highlight buckets paint each element once, under its worst severity", async () => {
  const result = await evaluateViewerValidationPayload({
    version: 4,
    sourceId: "test",
    severities: threeLevelSeverities,
    clauses: [
      severityClause("info-clause", "info-rule", "info", "Name"),
      severityClause("major-clause", "major-rule", "major", "Tag"),
    ],
    rows: [
      row(1, "IFCWALL", null, { "attribute:name": missing(), "attribute:tag": missing() }),
      row(2, "IFCWALL", null, { "attribute:name": missing(), "attribute:tag": present("T") }),
    ],
  });

  const highlights = groupViewerValidationResultsBySeverity(threeLevelSeverities, result.results);
  assert.deepEqual(highlights.major?.model, [1]);
  assert.deepEqual(highlights.info?.model, [2]);
  assert.deepEqual(highlights.critical, {});
});

test("importing keeps the user's severity definitions and appends unknown ones", () => {
  const current = [
    { id: "warn", label: "Renamed warn", color: "#111111", order: 1 },
    { id: "error", label: "Renamed error", color: "#222222", order: 2 },
  ];
  const incoming = [
    { id: "warn", label: "Warn", color: "#d29a2f", order: 1 },
    { id: "blocker", label: "Blocker", color: "#333333", order: 2 },
  ];

  const merged = mergeViewerValidationSeverities(current, incoming);

  // Existing ids keep the user's label, colour and rank; only genuinely new ids are added.
  assert.deepEqual(merged, [
    { id: "warn", label: "Renamed warn", color: "#111111", order: 1 },
    { id: "error", label: "Renamed error", color: "#222222", order: 2 },
    { id: "blocker", label: "Blocker", color: "#333333", order: 3 },
  ]);
});

function templateClause(): ViewerValidationClause {
  return {
    id: "clause-source",
    title: "Fire rating",
    rules: [
      {
        id: "rule-source-1",
        ifcType: "IFCWALL",
        target: { kind: "attribute", name: "Name" },
        check: { kind: "empty" },
        failSeverity: "error",
      },
      {
        id: "rule-source-2",
        ifcType: "IFCWALL",
        target: { kind: "property", group: "Pset_WallCommon", label: "FireRating" },
        check: { kind: "enum", allowedValues: ["60", "120"] },
        failSeverity: "warn",
      },
    ],
  };
}

test("cloning clauses gives every clause and rule a fresh id", () => {
  const source = templateClause();
  const [cloned] = cloneViewerValidationClauses([source]);

  assert.notEqual(cloned.id, source.id);
  assert.equal(cloned.rules.length, 2);
  for (const [index, rule] of cloned.rules.entries()) {
    assert.notEqual(rule.id, source.rules[index].id);
  }
});

test("cloning clauses leaves everything but the ids untouched", () => {
  const source = templateClause();
  const [cloned] = cloneViewerValidationClauses([source]);

  assert.equal(cloned.title, source.title);
  for (const [index, rule] of cloned.rules.entries()) {
    const original = source.rules[index];
    assert.equal(rule.ifcType, original.ifcType);
    assert.deepEqual(rule.target, original.target);
    assert.deepEqual(rule.check, original.check);
    assert.equal(rule.failSeverity, original.failSeverity);
  }
});

test("cloning the same clause twice yields disjoint ids, so a template can be inserted repeatedly", () => {
  const source = templateClause();
  const [first] = cloneViewerValidationClauses([source]);
  const [second] = cloneViewerValidationClauses([source]);

  assert.notEqual(first.id, second.id);

  const ids = new Set([
    first.id,
    second.id,
    ...first.rules.map((rule) => rule.id),
    ...second.rules.map((rule) => rule.id),
  ]);
  assert.equal(ids.size, 6);
});

test("cloning an empty clause list is a no-op", () => {
  assert.deepEqual(cloneViewerValidationClauses([]), []);
});

test("the severity tally counts rules per severity, most severe first", () => {
  const tally = countViewerValidationRulesBySeverity({
    version: 4,
    severities: defaultViewerValidationSeverities(),
    clauses: [
      {
        id: "c1",
        title: "Mixed",
        rules: [
          { ...templateClause().rules[0], id: "a", failSeverity: "warn" },
          { ...templateClause().rules[0], id: "b", failSeverity: "error" },
          { ...templateClause().rules[0], id: "c", failSeverity: "error" },
        ],
      },
    ],
  });

  assert.deepEqual(
    tally.map(({ id, count }) => ({ id, count })),
    [
      { id: "error", count: 2 },
      { id: "warn", count: 1 },
    ],
  );
});

test("the severity tally carries each severity's own label and colour", () => {
  const [top] = countViewerValidationRulesBySeverity({
    version: 4,
    severities: [{ id: "blocker", label: "Blocker", color: "#112233", order: 9 }],
    clauses: [
      { id: "c1", title: "One", rules: [{ ...templateClause().rules[0], failSeverity: "blocker" }] },
    ],
  });

  assert.equal(top.label, "Blocker");
  assert.equal(top.color, "#112233");
  assert.equal(top.count, 1);
});

test("the severity tally omits severities no rule uses", () => {
  const tally = countViewerValidationRulesBySeverity({
    version: 4,
    severities: defaultViewerValidationSeverities(),
    clauses: [
      { id: "c1", title: "Warnings only", rules: [{ ...templateClause().rules[0], failSeverity: "warn" }] },
    ],
  });

  assert.deepEqual(tally.map((entry) => entry.id), ["warn"]);
});

test("the severity tally of an empty config is empty", () => {
  assert.deepEqual(
    countViewerValidationRulesBySeverity({
      version: 4,
      severities: defaultViewerValidationSeverities(),
      clauses: [],
    }),
    [],
  );
});
