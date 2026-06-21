# COREY Validation Rules Contract for LLMs

Generate COREY validation configs as JSON. The portable config shape is:

```json
{
  "version": 2,
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
  "target": {},
  "check": {},
  "failSeverity": "error"
}
```

`failSeverity` must be `error` or `warn`.

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

Pattern:

```json
{
  "kind": "pattern",
  "pattern": "[0-9A-Za-z_$]{22}",
  "caseInsensitive": false
}
```

The pattern is JavaScript regex source text. COREY matches it against the whole
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
- IFC type and target matching are case-insensitive.
- `GlobalId`, `GUID`, and `_guid` refer to the same attribute target.
- If an element fails several rules, `error` outranks `warn`.

## Common mistakes to avoid

- Do not put `rules` at the root.
- Do not use severity values like `warning`, `critical`, or `info`.
- Do not use check kinds like `required`, `range`, or `regex`; use COREY's exact
  check kind strings.
- Do not leave enum `allowedValues` empty.
- Do not leave `ifcType`, attribute `name`, property `group`, or property
  `label` blank.

## Complete example

```json
{
  "version": 2,
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
