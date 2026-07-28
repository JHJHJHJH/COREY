# Clause data model

This is the canonical developer contract for COREY validation clause and rule
JSON. The runtime TypeScript interfaces live in `src/features/viewer/types.ts`,
and the parser, sanitizer, compiler, and evaluator live in
`src/features/rules/lib/validation.ts`.

## Config shape

Rule configuration uses `version: 2`. It is used by clause import/export,
backend rule config storage, rule templates, and the `clauses` portion of
validation evaluation payloads.

```json
{
  "version": 2,
  "clauses": [
    {
      "id": "wall-basics",
      "title": "Wall basics",
      "rules": [
        {
          "id": "wall-name-required",
          "ifcType": "IfcWall",
          "target": {
            "kind": "attribute",
            "name": "Name"
          },
          "check": {
            "kind": "empty"
          },
          "failSeverity": "error"
        }
      ]
    }
  ]
}
```

Top-level fields:

| Field | Type | Notes |
|---|---|---|
| `version` | literal `2` | Current portable config version. |
| `clauses` | `ViewerValidationClause[]` | Named groups of rules. |

## Clause

| Field | Type | Notes |
|---|---|---|
| `id` | string | Stable clause identifier. Generated when missing during sanitization. |
| `title` | string | Human-readable result grouping. Blank titles sanitize to `Untitled clause`. |
| `rules` | `ViewerValidationRule[]` | Rules evaluated under this clause. |

Clause ids are used in validation failures and data-table clause filters. Treat
them as stable once a config is shared.

## Rule

| Field | Type | Notes |
|---|---|---|
| `id` | string | Stable rule identifier. Generated when missing during sanitization. |
| `ifcType` | string | IFC entity name, such as `IfcWall`. Matching is case-insensitive. |
| `target` | `ViewerValidationTarget` | Attribute or property to inspect. |
| `check` | `ViewerValidationCheck` | Constraint applied to the target value. |
| `failSeverity` | `error` or `warn` | Severity emitted when this rule fails. Defaults to `error` if invalid input is sanitized. |

## Target variants

Attribute target:

```json
{
  "kind": "attribute",
  "name": "GlobalId"
}
```

Property target:

```json
{
  "kind": "property",
  "group": "Pset_WallCommon",
  "label": "FireRating"
}
```

Target matching is normalized. IFC type, property set, property label, and most
attribute names are trimmed and compared case-insensitively. Attribute targets
`_guid`, `guid`, and `globalid` all normalize to `globalid`.

## Check variants

Every check fails if the inspected value state is `missing`, `empty`, `null`, or
`undefined`.

Required value:

```json
{
  "kind": "empty"
}
```

Despite the internal name, `empty` means "must not be empty".

Allowed values:

```json
{
  "kind": "enum",
  "allowedValues": ["WALL-A", "WALL-B"]
}
```

Enum allowed values are trimmed, empty entries are removed, duplicates are
deduplicated, and comparison is case-insensitive.

Number range:

```json
{
  "kind": "numberRange",
  "min": 0,
  "max": 120
}
```

`min` and `max` may be numbers or `null`. At least one bound is required for the
rule to run. Values must parse to finite JavaScript numbers.

Pattern:

```json
{
  "kind": "pattern",
  "pattern": "[0-9A-Za-z_$]{22}",
  "caseInsensitive": false
}
```

`pattern` is JavaScript regular expression source text. The evaluator anchors it
against the whole value as `^(?:pattern)$`. Invalid or blank patterns are not
runnable.

Boolean:

```json
{
  "kind": "boolean",
  "expected": true
}
```

Boolean values are parsed from `true`, `1`, `yes`, `y`, `.t.`, `t`, `false`,
`0`, `no`, `n`, `.f.`, and `f`, case-insensitively.

Native value type:

```json
{
  "kind": "type",
  "expectedType": "number"
}
```

`expectedType` is `string`, `number`, or `boolean`. Matching is strict and uses
the native scalar kind recorded while reading the IFC value. A string such as
`"42"` does not pass a `number` type check, and a string such as `"true"` does
not pass a `boolean` type check.

## Runnable rules

The persisted config shape can contain incomplete draft rows from the rule
editor. `compileViewerValidationRules` sanitizes clauses and compiles only
runnable rules.

A rule is runnable when:

- `ifcType` is not blank.
- attribute targets have a non-blank `name`.
- property targets have non-blank `group` and `label`.
- enum checks have at least one `allowedValues` entry after sanitization.
- number range checks have `min` or `max`.
- pattern checks have non-blank valid JavaScript regex source.

Boolean, type, and required-value checks need no extra fields beyond their
required shape.

## Evaluation payloads

`POST /api/rules/evaluate` wraps the same clause model with rows to evaluate.

```json
{
  "version": 2,
  "sourceId": "model-123",
  "clauses": [],
  "rows": [
    {
      "modelId": "model-123",
      "localId": 42,
      "ifcType": "IfcWall",
      "values": {
        "attribute:globalid": {
          "text": "0F4...example",
          "state": "present",
          "valueKind": "string"
        },
        "property:pset_wallcommon::firerating": {
          "text": "2HR",
          "state": "present",
          "valueKind": "string"
        }
      }
    }
  ]
}
```

Row value keys are validation target ids:

- attribute: `attribute:${normalizedAttributeName}`
- property: `property:${normalizedPropertySet}::${normalizedPropertyLabel}`

Inspection value states are `present`, `missing`, `empty`, `null`, and
`undefined`. `valueKind` is `string`, `number`, `boolean`, or `null`. Existing
evaluation payloads without `valueKind` remain accepted, but a type check fails
when the value kind is unknown.

The result shape is:

```json
{
  "sourceId": "model-123",
  "results": [
    {
      "modelId": "model-123",
      "localId": 42,
      "result": "warn",
      "failedClauses": []
    }
  ],
  "failedClauseCount": 0,
  "failedClauses": []
}
```

Only failed elements appear in `results`. Clause failures aggregate unique
`clauseId::ruleId` failures, and an element's result is the highest severity of
its failed rules.

## Public artifacts

- JSON Schema: `public/schemas/validation-config-v2.schema.json`
- LLM contract: `public/llms-validation-rules.md`
- In-app docs: `content/docs/clause-data-model.mdx`
- Example config: `sample-rules.json`
