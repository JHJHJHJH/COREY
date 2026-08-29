# Clause data model

This is the canonical developer contract for COREY validation clause and rule
JSON. The runtime TypeScript interfaces live in `src/features/viewer/types.ts`,
and the parser, sanitizer, compiler, and evaluator live in
`src/features/rules/lib/validation.ts`.

## Config shape

Rule configuration uses `version: 4`. It is used by clause import/export,
backend rule config storage, rule templates, and the `clauses` portion of
validation evaluation payloads.

```json
{
  "version": 4,
  "severities": [
    { "id": "warn", "label": "Warn", "color": "#d29a2f", "order": 1 },
    { "id": "error", "label": "Error", "color": "#bb5a36", "order": 2 }
  ],
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
| `version` | literal `4` | Current portable config version. |
| `severities` | `ViewerValidationSeverity[]` | Configurable failure levels referenced by rules. |
| `clauses` | `ViewerValidationClause[]` | Named groups of rules. |

## Severities

Severity levels are user-configurable and live in the root `severities` array. The list is always
non-empty and is sorted by `order` ascending when sanitized.

| Field | Type | Notes |
| --- | --- | --- |
| `id` | `string` | Stable slug (`a-z0-9_-`) referenced by `rule.failSeverity`. `ok` is reserved for the non-failure result and is rejected. |
| `label` | `string` | Display name. Falls back to `id` when blank. |
| `color` | `string` | Base `#rrggbb` colour. Border and background tones are derived from it; the 3D viewer paints failing elements with it. |
| `order` | `integer` | Rank, higher is more severe. Renumbered densely from 1 on sanitize. |

Ranking rules:

- `ok` always ranks below every severity.
- Clause and element results are max-severity rollups: when an element fails several rules, the
  severity with the highest `order` is the one reported, and the one the 3D view paints it with.
- Individual rule failures keep their own severity, so severity *filters* still match an element
  under every level it failed at. Per-severity counts can therefore sum to more than the number of
  failing elements.
- A `failSeverity` naming a severity that is not configured is remapped to the highest-order
  severity, never silently downgraded.

Defaults, seeded for new configs and when migrating from version 2 or 3:

```json
[
  { "id": "warn", "label": "Warn", "color": "#d29a2f", "order": 1 },
  { "id": "error", "label": "Error", "color": "#bb5a36", "order": 2 }
]
```

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
| `subtype` | string (optional) | Predefined type, ANDed with `ifcType` — such as `FLOOR` for `IfcSlab`. Matching is case-insensitive. Omitted or blank means any subtype, which is how every rule authored before this field behaves. See [Subtype applicability](#subtype-applicability). |
| `target` | `ViewerValidationTarget` | Attribute or property to inspect. |
| `check` | `ViewerValidationCheck` | Constraint applied to the target value. |
| `failSeverity` | severity `id` | Severity emitted when this rule fails. Must name an entry in the root `severities` array; an unrecognized id is remapped to the highest-order severity rather than downgraded. |

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

Regex:

```json
{
  "kind": "regex",
  "regex": "[0-9A-Za-z_$]{22}",
  "caseInsensitive": false
}
```

`regex` is JavaScript regular expression source text. The evaluator anchors it
against the whole value as `^(?:regex)$`. Invalid or blank regular expressions are not
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

## Subtype applicability

A rule applies to an element when **both** hold:

1. `ifcType` matches the element's IFC entity name.
2. `subtype` is blank or absent, **or** it matches the element's resolved subtype.

Both comparisons are case-insensitive and trim surrounding whitespace.

An element's subtype is its `PredefinedType`, except when that is `USERDEFINED`, where
`ObjectType` is used instead — that is where IFC-SG models carry project-specific types. The
predefined type is read from the element itself, falling back to its type object
(`IsTypedBy` / `IsDefinedBy` → `RelatingType`), so a rule matches the same way whether the exporter
put the value on the occurrence or the type.

A subtype mismatch makes the rule **inapplicable**, never failed. `IfcSlab` + `subtype: FLOOR` is
silent on roof slabs. This is what distinguishes `subtype` from a rule whose *target* is the
`PredefinedType` attribute — the latter reports every non-`FLOOR` slab as a failure.

Rules with and without a subtype coexist on the same IFC type: a `FLOOR` slab is evaluated by both
`IfcSlab` rules and `IfcSlab` + `FLOOR` rules.

Because `subtype` is omitted from serialized output when blank, configs written before this field
existed round-trip unchanged.

## Runnable rules

The persisted config shape can contain incomplete draft rows from the rule
editor. `compileViewerValidationRules` sanitizes clauses and compiles only
runnable rules.

A rule is runnable when:

- `ifcType` is not blank. A blank `subtype` is valid and means "any subtype".
- attribute targets have a non-blank `name`.
- property targets have non-blank `group` and `label`.
- enum checks have at least one `allowedValues` entry after sanitization.
- number range checks have `min` or `max`.
- regex checks have non-blank valid JavaScript regular expression source.

Boolean and required-value checks need no extra fields beyond their required
shape.

## Evaluation payloads

`POST /api/rules/evaluate` wraps the same clause model with rows to evaluate.

```json
{
  "version": 4,
  "severities": [
    { "id": "warn", "label": "Warn", "color": "#d29a2f", "order": 1 },
    { "id": "error", "label": "Error", "color": "#bb5a36", "order": 2 }
  ],
  "sourceId": "model-123",
  "clauses": [],
  "rows": [
    {
      "modelId": "model-123",
      "localId": 42,
      "ifcType": "IfcWall",
      "subtype": "SOLIDWALL",
      "values": {
        "attribute:globalid": {
          "text": "0F4...example",
          "state": "present"
        },
        "property:pset_wallcommon::firerating": {
          "text": "2HR",
          "state": "present"
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
`undefined`.

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

- JSON Schema: `public/schemas/validation-config-v4.schema.json`
- LLM contract: `public/llms-validation-rules.md`
- In-app docs: `content/docs/clause-data-model.mdx`
- Example config: `sample-rules.json`
