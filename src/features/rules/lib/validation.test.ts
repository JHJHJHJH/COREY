import assert from "node:assert/strict";
import test from "node:test";
import type {
  ViewerValidationClause,
  ViewerValidationRow,
  ViewerValidationValue,
} from "@/features/viewer/types";
import {
  buildViewerValidationRuleKey,
  evaluateViewerValidationPayload,
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
    version: 3,
    sourceId: "test",
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
      version: 3,
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

test("version 2 pattern checks migrate to version 3 regex checks", () => {
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

  assert.equal(config.version, 3);
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

  assert.equal(config.version, 3);
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
