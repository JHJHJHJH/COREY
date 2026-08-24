# COREY Validation Rules Contract for LLMs

Generate COREY validation configs as JSON. The portable config shape is:

```json
{
  "version": 4,
  "severities": [],
  "clauses": []
}
```

Do not generate the legacy `version: 1` root `rules` format.

## Required shape

Each clause:

```json
{
  "id": "stable-clause-id",
  "title": "Human-readable clause title",
  "rules": []
}
```

Each rule:

```json
{
  "id": "stable-rule-id",
  "ifcType": "IfcWall",
  "subtype": "SOLIDWALL",
  "target": {},
  "check": {},
  "failSeverity": "error"
}
```

`failSeverity` must be the `id` of one of the entries in the root `severities` array.

## Severities

Severity levels are user-configurable. Each entry:

```json
{
  "id": "error",
  "label": "Error",
  "color": "#bb5a36",
  "order": 2
}
```

- `id` is lowercase `a-z0-9_-`, must not be `ok` (reserved for the non-failure result), and is what
  `failSeverity` references.
- `order` is the rank: higher is more severe. If an element fails several rules, the highest
  `order` wins — that is the severity and colour reported for it.
- `color` is a `#rrggbb` base colour used for badges and for painting the element in the 3D view.
- The list must contain at least one entry. If you have no reason to define your own, use the
  defaults: `warn` (`#d29a2f`, order 1) and `error` (`#bb5a36`, order 2).

`subtype` is optional. Omit it (or leave it blank) to apply the rule to every element of `ifcType`.
Set it to a predefined type — `FLOOR` for `IfcSlab`, `SOLIDWALL` for `IfcWall` — to narrow the rule
to those elements only. It is ANDed with `ifcType`.

## Targets

Use exactly one target variant.

Attribute:

```json
{
  "kind": "attribute",
  "name": "GlobalId"
}
```

Property:

```json
{
  "kind": "property",
  "group": "Pset_WallCommon",
  "label": "FireRating"
}
```

## Checks

Use exactly one check variant.

Required value:

```json
{
  "kind": "empty"
}
```

Allowed values:

```json
{
  "kind": "enum",
  "allowedValues": ["A", "B", "C"]
}
```

Number range:

```json
{
  "kind": "numberRange",
  "min": 0,
  "max": 100
}
```

Use `null` for an open bound, but do not make both `min` and `max` null.

Regex:

```json
{
  "kind": "regex",
  "regex": "[0-9A-Za-z_$]{22}",
  "caseInsensitive": false
}
```

The regex is JavaScript regular expression source text. COREY matches it against the whole
value, so do not add leading `^` or trailing `$` unless you intentionally want
anchors inside the regex source.

Boolean:

```json
{
  "kind": "boolean",
  "expected": true
}
```

## Evaluation rules

- Missing, empty, null, or undefined values fail every check kind.
- Enum comparison trims values and ignores case.
- Boolean checks accept `true`, `1`, `yes`, `y`, `.t.`, `t`, `false`, `0`,
  `no`, `n`, `.f.`, and `f`, case-insensitively.
- IFC type, subtype, and target matching are case-insensitive.
- An element's subtype is its `PredefinedType`, or `ObjectType` when `PredefinedType`
  is `USERDEFINED`.
- A rule whose `subtype` does not match the element is simply not evaluated against
  that element. It does not produce a failure. Use `subtype` to scope a rule; use a
  `PredefinedType` attribute target only when a wrong predefined type is itself the defect.
- `GlobalId`, `GUID`, and `_guid` refer to the same attribute target.
- If an element fails several rules, the severity with the highest `order` wins.

## Common mistakes to avoid

- Do not put `rules` at the root.
- Do not use a `failSeverity` that is not declared in the root `severities` array.
- Do not use `ok` as a severity id; it is reserved for the non-failure result.
- Do not use check kinds like `required`, `range`, or `pattern`; use COREY's exact
  check kind strings.
- Do not leave enum `allowedValues` empty.
- Do not leave `ifcType`, attribute `name`, property `group`, or property
  `label` blank. `subtype` is the only applicability field that may be blank or omitted.
- Do not use `subtype` to assert that an element *should* have a given predefined
  type — it filters which elements a rule applies to, so a mismatch is silent.

## Complete example

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
          "id": "wall-globalid-required",
          "ifcType": "IfcWall",
          "target": {
            "kind": "attribute",
            "name": "GlobalId"
          },
          "check": {
            "kind": "empty"
          },
          "failSeverity": "error"
        },
        {
          "id": "wall-reference-enum",
          "ifcType": "IfcWall",
          "target": {
            "kind": "property",
            "group": "Pset_WallCommon",
            "label": "Reference"
          },
          "check": {
            "kind": "enum",
            "allowedValues": ["WALL-A", "WALL-B", "WALL-C"]
          },
          "failSeverity": "warn"
        }
      ]
    }
  ]
}
```
