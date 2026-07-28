import assert from "node:assert/strict";
import test from "node:test";
import {
  buildViewerValidationRows,
  describeViewerValidationRule,
  evaluateViewerValidationPayload,
  parseViewerValidationConfig,
  parseViewerValidationRunPayload,
} from "@/features/rules/lib/validation";
import type {
  ViewerDataTableCell,
  ViewerDataTableData,
  ViewerValidationCheck,
  ViewerValidationClause,
  ViewerValidationValueKind,
} from "@/features/viewer/types";

function clauses(check: ViewerValidationCheck): ViewerValidationClause[] {
  return [
    {
      id: "types",
      title: "Value types",
      rules: [
        {
          id: "name-type",
          ifcType: "IfcWall",
          target: { kind: "attribute", name: "Name" },
          check,
          failSeverity: "error",
        },
      ],
    },
  ];
}

function cell(raw: unknown, valueKind: ViewerDataTableCell["valueKind"]): ViewerDataTableCell {
  return {
    raw,
    text: String(raw),
    state: "present",
    source: "ifc",
    binding: { kind: "attribute", name: "Name" },
    valueKind,
    original: null,
  };
}

function dataWithNames(entries: Array<[raw: unknown, declaredKind: ViewerDataTableCell["valueKind"]]>) {
  return {
    columns: [],
    ifcTypes: ["IFCWALL"],
    rows: entries.map(([raw, declaredKind], index) => ({
      key: `model:${index + 1}`,
      modelId: "model",
      localId: index + 1,
      ifcType: "IFCWALL",
      selection: {
        modelId: "model",
        localId: index + 1,
        label: `Wall ${index + 1}`,
        category: "IFCWALL",
      },
      cells: { name: cell(raw, declaredKind) },
      searchText: String(raw),
    })),
  } satisfies ViewerDataTableData;
}

test("type checks parse and describe all supported scalar kinds", () => {
  for (const expectedType of [
    "string",
    "number",
    "boolean",
  ] satisfies ViewerValidationValueKind[]) {
    const config = parseViewerValidationConfig({
      version: 2,
      clauses: clauses({ kind: "type", expectedType }),
    });

    assert.deepEqual(config.clauses[0]?.rules[0]?.check, { kind: "type", expectedType });
    assert.equal(
      describeViewerValidationRule(config.clauses[0]!.rules[0]!),
      `Name must have type ${expectedType}`,
    );
  }
});

test("type checks use each cell's native value without text coercion", async () => {
  const ruleClauses = clauses({ kind: "type", expectedType: "number" });
  const data = dataWithNames([
    [42, "number"],
    ["42", "number"],
    [{ type: 4, value: 60 }, "string"],
  ]);
  const rows = buildViewerValidationRows(data, ruleClauses);

  assert.deepEqual(
    rows.map((row) => row.values["attribute:name"]?.valueKind),
    ["number", "string", "number"],
  );

  const result = await evaluateViewerValidationPayload({
    version: 2,
    sourceId: "model",
    clauses: ruleClauses,
    rows,
  });

  assert.deepEqual(
    result.results.map((entry) => entry.localId),
    [2],
  );
});

test("strict type checks distinguish booleans from boolean-looking strings", async () => {
  const ruleClauses = clauses({ kind: "type", expectedType: "boolean" });
  const rows = buildViewerValidationRows(
    dataWithNames([
      [true, "boolean"],
      ["true", "string"],
    ]),
    ruleClauses,
  );

  const result = await evaluateViewerValidationPayload({
    version: 2,
    sourceId: "model",
    clauses: ruleClauses,
    rows,
  });

  assert.deepEqual(
    result.results.map((entry) => entry.localId),
    [2],
  );
});

test("type checks fail safely when an API row omits valueKind", async () => {
  const payload = parseViewerValidationRunPayload({
    version: 2,
    sourceId: "model",
    clauses: clauses({ kind: "type", expectedType: "string" }),
    rows: [
      {
        modelId: "model",
        localId: 1,
        ifcType: "IFCWALL",
        values: {
          "attribute:name": {
            text: "Wall",
            state: "present",
          },
        },
      },
    ],
  });

  assert.equal(payload.rows[0]?.values["attribute:name"]?.valueKind, null);
  const result = await evaluateViewerValidationPayload(payload);
  assert.equal(result.results[0]?.result, "error");
});

test("existing Boolean equality checks keep their coercion behavior", async () => {
  const ruleClauses = clauses({ kind: "boolean", expected: true });
  const result = await evaluateViewerValidationPayload({
    version: 2,
    sourceId: "model",
    clauses: ruleClauses,
    rows: [
      {
        modelId: "model",
        localId: 1,
        ifcType: "IFCWALL",
        values: {
          "attribute:name": {
            text: "true",
            state: "present",
            valueKind: "string",
          },
        },
      },
    ],
  });

  assert.equal(result.results.length, 0);
});
