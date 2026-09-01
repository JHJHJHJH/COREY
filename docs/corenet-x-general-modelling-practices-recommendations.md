# CORENET X General Modelling Practices: Recommendations for COREY

Status: Product and engineering recommendation  
Source review date: 30 August 2026

## Executive summary

COREY already supports the strongest part of a submission-readiness workflow at
element level:

```text
Open IFC -> inspect -> validate -> correct -> export IFC -> validate again
```

Practitioners can inspect IFC structure and properties, run configurable data
checks, locate failures in 3D, batch-edit data through Excel, write eligible
changes back to IFC, and compare stored model versions.

The largest gaps against the
[CORENET X General Modelling Practices](https://info.corenet.gov.sg/ifc-sg/modelling---authoring/GeneralModellingPractices)
are checks that operate above a single element or single model. These include
storey alignment across disciplines, one-block-per-file structure,
geo-referencing, federation, GUID uniqueness across files, rule-based clashes,
and grid coverage across storeys.

The recommended product direction is therefore:

1. Add dedicated single-model readiness audits on top of the existing clause
   engine.
2. Introduce project packages so separate discipline and block files can be
   assessed together before they are rendered together.
3. Add federated 3D review and rule-based clash workflows after package metadata
   and coordinate checks are reliable.
4. Support previewable, reversible IFC repair only where COREY can preserve IFC
   semantics, relationships, identity, and geometry.

COREY should describe the result as **submission readiness**, not certification
or a guarantee of agency acceptance.

## Sources and interpretation

This recommendation is based on the 12 practices listed on the official general
modelling page and the infographic published for each practice. It also uses the
official descriptions of the
[IFC+SG data structure](https://info.corenet.gov.sg/ifc-sg/requirements---submission/ifcsg-data-structure)
and
[IFC+SG Excel Mapping File](https://info.corenet.gov.sg/ifc-sg/requirements---submission/ifc-sg-excel-mapping-file).

The mapping-file page describes the workbook as the source for IFC entities,
SGPsets, properties, and controlled values, and currently labels the latest
download **4 December 2025**. The workbook itself states that the mapping is a
work in progress. COREY must consequently retain the source version used for
every check and report.

The three official resources have distinct roles:

- The Code of Practice establishes what is required for a submission stage and
  agency.
- The glossary defines and explains identified components.
- The Excel mapping file defines how components and data are represented in
  IFC+SG.

Machine-generating checks from the mapping workbook alone is not enough to
determine submission applicability. A submission profile and curated links to
the relevant COP requirements are also required.

## Current COREY baseline

The current repository provides more than the original viewer-only v1:

- Local browser-only IFC loading and optional server-backed model storage.
- 3D selection, isolation, hiding, sections, and length measurement.
- Spatial/model tree, relationship graph, properties inspection, and bulk data
  table.
- Clause-based validation by IFC entity and optional subtype, with required,
  enum, number-range, regex, and boolean checks.
- Correct subtype resolution from occurrence or type-object `PredefinedType`,
  falling back to `ObjectType` for `USERDEFINED`.
- Validation highlighting, severity and clause filtering, and navigation from
  table results to 3D elements.
- Scalar edits through the property panel or Excel round trip, followed by IFC
  export.
- Optional persisted drafts, model versions, structural/property comparison,
  validation comparison, and side-by-side 3D version comparison.
- A small set of rule templates, including partial BCA column and beam mapping
  checks.

These are strong foundations for data requirements, but version comparison must
not be confused with multi-discipline federation. The current main viewport
still reviews one model at a time.

### Coverage labels

- **Supported**: COREY can substantially perform the required review today.
- **Partial**: useful current features exist, but important checks remain manual.
- **Gap**: COREY cannot currently produce reliable evidence for the requirement.

## Practice-by-practice assessment

### 1. Applying consistent level naming

Official guidance:
[Level naming and organisation](https://info.corenet.gov.sg/ifc-sg/modelling---authoring/GeneralModellingPractices/level-naming)

The same physical level should use the same name and Z value across disciplines.
Different physical levels require different names. A suffix such as `_SFL` is
appropriate when a structural level is at a different elevation, rather than as
an arbitrary discipline-specific naming variation.

**Coverage: Partial**

Current workflow:

- Inspect `IfcBuildingStorey` nodes in the model tree and data table.
- Add clauses for required `Name` and `Elevation` values, naming regexes, or an
  agreed list of names.
- Use table editing or Excel to correct storey names and export a revised IFC.
- Compare separate discipline files manually outside COREY.

Recommended features:

- Add a dedicated **Storey Alignment** audit that detects duplicate names,
  duplicate elevations, the same name at different elevations, and different
  names representing the same elevation.
- Compare storeys across package files by normalized units and elevation. Use a
  configurable 1 mm grouping tolerance as a clearly labelled COREY heuristic,
  while always reporting the raw difference.
- Let the user define or import the project naming convention and recognized
  suffixes.
- Repair names through the existing draft/writeback workflow. Do not change
  placements or elevations automatically; produce authoring-tool instructions
  for those cases.

### 2. Block mechanism

Official guidance:
[Block mechanism](https://info.corenet.gov.sg/ifc-sg/modelling---authoring/GeneralModellingPractices/block-mechanism)

The architectural example separates block, podium, basement, and site/external
works into appropriate files. Each architectural block file represents one block
and contains one `IfcSite`, whose name identifies that block.

**Coverage: Partial**

Current workflow:

- Open each file separately and inspect its site/building hierarchy.
- Filter the table to `IfcSite` or `IfcBuilding` and check names manually.
- Maintain the intended file inventory outside COREY.

Recommended features:

- Introduce a **Project Package** manifest containing each model's discipline,
  block, site, package role, and version.
- Check architectural block files for exactly one `IfcSite`, site name matching
  the declared block, and one-block-per-file structure.
- Detect missing, duplicate, or unexpected block, podium, basement, and site
  files against the package manifest.
- Treat discipline-specific variations as requirement-pack policy rather than
  hard-coding the architectural example for every discipline.
- Allow safe site/building name repairs. Leave re-partitioning and spatial
  containment restructuring to authoring tools unless a later repair path is
  proven by IFC round-trip tests.

### 3. Correct IFC entities

Official guidance:
[Correct IFC entities](https://info.corenet.gov.sg/ifc-sg/modelling---authoring/GeneralModellingPractices/correct-ifc-entities)

An identified component must export using the correct IFC entity, applicable
subtype, and required Psets or SGPsets.

**Coverage: Partial, with a strong existing foundation**

Current workflow:

- Scope rules by IFC entity and optional subtype.
- Check required properties, allowed values, ranges, formats, and booleans.
- Highlight failures in 3D and correct eligible scalar values through the data
  table or Excel.
- Manually create or import clauses for the relevant mapping rows.

Recommended features:

- Add a versioned mapping importer that normalizes identified component,
  agency, discipline, IFC entity, subtype, property set, property name, data
  type, unit, and accepted values.
- Generate checks only after applying the active submission profile and curated
  COP applicability.
- Show mapping evidence beside each result: expected component, entity,
  subtype, property, unit, and accepted value.
- Ask the practitioner to confirm component intent where it cannot be inferred
  from exported IFC data.
- Repair properties and eligible subtype fields. Do not automatically rewrite
  an entity class: that can affect schema constructors, relationships, type
  assignments, geometry, and downstream identity.

### 4. Predefined type versus USERDEFINED

Official guidance:
[IFC subtype](https://info.corenet.gov.sg/ifc-sg/modelling---authoring/GeneralModellingPractices/predefined-type-vs-userdefined)

The mapping distinguishes three cases: no subtype, an IFC predefined value, or a
mapping value marked for `USERDEFINED`. In the last case the IFC predefined type
must be `USERDEFINED` and the actual approved value must also be supplied.

**Coverage: Partial**

Current workflow:

- COREY already resolves subtype consistently from `PredefinedType`, its type
  object, and `ObjectType` for `USERDEFINED`.
- Clauses can target an expected subtype or validate the raw fields with enum or
  regex checks.
- Practitioners must encode the valid combinations themselves.

Recommended features:

- Add a dedicated subtype check with explicit `not-applicable`, `predefined`,
  and `user-defined` modes derived from the active mapping pack.
- Detect missing `ObjectType`, invalid combinations, spelling/case errors,
  embedded spaces, and custom values absent from the mapping.
- Provide an allowed-value picker rather than free text for assisted repair.
- Preview and revalidate `PredefinedType` and `ObjectType` changes before IFC
  export.

### 5. Use the mapping file, COP, and glossary together

Official guidance:
[Using the three references](https://info.corenet.gov.sg/ifc-sg/modelling---authoring/GeneralModellingPractices/using-cop--excel-mapping-file---glossary)

**Coverage: Partial**

Current workflow:

- Build or import reusable clause JSON from the relevant reference documents.
- Use the bundled templates as demonstrations rather than complete submission
  profiles.
- Consult the official documents separately when interpreting a failure.

Recommended features:

- Add immutable **Requirement Packs** identified by source version, URL, import
  date, and content hash.
- Add a **Submission Profile** selecting gateway, agencies, disciplines, and the
  requirement-pack version.
- Link every generated check and readiness issue to its mapping row and curated
  COP/glossary explanation.
- Provide change impact between packs: added, removed, and modified requirements
  without silently changing historical audit results.
- Import official workbooks supplied by users or administrators. Do not bundle
  or redistribute official source content unless permission is confirmed.

### 6. Different authoring-element representation

Official guidance:
[Different element representation](https://info.corenet.gov.sg/ifc-sg/modelling---authoring/GeneralModellingPractices/use-different-element)

The authoring tool's suggested native object is not mandatory when another
representation is appropriate, provided the exported IFC has the correct entity,
subtype, and required IFC+SG properties.

**Coverage: Partial**

Current workflow:

- Select the exported element and inspect its actual entity, subtype, and
  properties.
- Run applicable clauses against the exported result.
- Manually determine whether missing properties arose from the alternative
  authoring representation.

Recommended features:

- Make this an explicitly outcome-based check. COREY should not fail an element
  merely because a different native authoring object may have been used.
- Let users associate selected IFC elements with an identified component when
  intent is ambiguous.
- Explain which required properties are commonly absent when an alternative
  native object is used.
- Repair eligible subtype and property data, but send entity conversion and
  geometry changes back to the authoring application.

### 7. Project coordinates and geo-referencing

Official guidance:
[Project coordinates and geo-referencing](https://info.corenet.gov.sg/ifc-sg/modelling---authoring/GeneralModellingPractices/project-coordinates---geo-referencing)

Models should use Singapore's SVY21 horizontal reference, SHD vertical datum,
real-world orientation/True North, and a shared coordinate reference across
disciplines.

**Coverage: Gap**

Current workflow:

- Use the authoring tool or a specialist IFC coordination viewer to confirm
  coordinates, orientation, and datum.
- COREY may expose some raw fields, but it does not currently assemble them into
  a reliable geo-reference assessment.

Recommended features:

- Add a headless **Geo-reference Audit** for project units,
  `IfcProjectedCRS`, `IfcMapConversion`, representation contexts, True North,
  origins, placements, and abnormal offsets.
- Normalize units before comparing package files and display both normalized and
  source values.
- Compare CRS identity, eastings/northings, height, rotation, scale, and model
  bounds across disciplines.
- Visualize origin, True North, survey reference, and any detected offset.
- Allow repair of missing metadata only when licensed survey values are supplied
  and a preflight proves no geometry transformation is needed. Coordinate
  transformations and placement moves remain authoring-tool work.

### 8. Federation alignment

Official guidance:
[Federation alignment](https://info.corenet.gov.sg/ifc-sg/modelling---authoring/GeneralModellingPractices/federatemodel)

Federation means separate discipline models aligned for combined review, not
merged into one IFC. Coordinate systems, origins, orientation, survey reference,
site/building structure, and storey names/elevations must align.

**Coverage: Gap**

Current workflow:

- Review files individually in COREY.
- Use an external federation tool for combined alignment review.
- Do not use COREY's version comparison as evidence of discipline alignment.

Recommended features:

- Begin with package-level metadata, storey, coordinate, and bounds comparison
  before loading several models into WebGL.
- Add federated loading with separate model identities, per-model colours,
  visibility, ghosting, selection, and discipline filters.
- Provide an alignment matrix covering CRS, origin, rotation, scale, storeys,
  grids, and bounding-box offsets.
- Display offset vectors and raw discrepancies. Never silently transform a model
  simply to make the overlay look correct.
- Keep each source IFC separate through review and reporting.

### 9. Maintain unique GUIDs

Official guidance:
[Unique GUIDs](https://info.corenet.gov.sg/ifc-sg/modelling---authoring/GeneralModellingPractices/maintain-unique-guids-across-models)

Every IFC element requires a unique identity. Repeated or similar elements are
valid; reusing a GUID for different elements or copied model files is not.

**Coverage: Partial**

Current workflow:

- Inspect, sort, or export `GlobalId` values from the data table.
- Use clauses to require a value and check compressed IFC GUID format.
- Review duplicate warnings surfaced during stored-version comparison.
- Check cross-file duplicates outside COREY.

Recommended features:

- Add set-based missing, malformed, and duplicate GUID checks within every file
  and across the package.
- Compare versions to distinguish expected stable identities from deleted/new
  elements and suspicious mass GUID regeneration.
- For assisted repair, require the user to select the canonical occurrence,
  generate new valid IFC GUIDs for the others, and preview the old-to-new map.
- Reopen and rescan the exported IFC, and retain the identity map in the audit
  report so issue history remains traceable.

### 10. Manage file size for performance

Official guidance:
[File size and performance](https://info.corenet.gov.sg/ifc-sg/modelling---authoring/GeneralModellingPractices/managing-file-size-for-performance)

The published infographic recommends no more than 800 MB per IFC file and asks
teams to model only the scope and level of detail required for the relevant
gateway.

**Coverage: Partial**

Current workflow:

- Read file size from the viewer status and compare it with the recommendation.
- Use load behaviour as an informal signal of model complexity.
- Split or simplify the model in its authoring tool.

The configurable self-hosted upload limit is deployment policy and is separate
from the CORENET X recommendation.

Recommended features:

- Add a non-blocking readiness warning at 800,000,000 bytes, treating “MB” as
  decimal unless the active requirement pack says otherwise.
- Report counts for elements, geometry-bearing elements, geometry complexity,
  properties, and heavy categories, together with parse/index/render timings.
- Identify likely over-modelling and unusually heavy element types without
  claiming every large object is unnecessary.
- Recommend block, zone, or discipline splits and gateway-appropriate detail.
  Do not automatically split IFC files.

### 11. Model coordination and clash detection

Official guidance:
[Clash detection](https://info.corenet.gov.sg/ifc-sg/modelling---authoring/GeneralModellingPractices/check-clashes)

CORENET X clash review is rule-based, not just intersection-based. The published
example treats a door intersecting a structural beam as a failure, while a pipe
penetration can pass, alert, or fail according to element type and size.

**Coverage: Gap**

Current workflow:

- Use isolate, section, and measurement for manual investigation of a known
  coordination concern.
- Run automated clash detection and issue management in an external coordination
  tool.

Recommended features:

- Build clash candidate detection on federated models using spatial indexes or
  BVHs, with expensive geometry work kept off the React render path.
- Store a versioned clash matrix by discipline, IFC entity pair, geometry test,
  size/clearance threshold, and outcome.
- Classify results as pass, alert, or fail according to the active requirement
  pack; do not hard-code one screenshot's examples as universal rules.
- Add issue triage, assigned status, acceptance rationale, saved viewpoints,
  comments, recheck, and BCF import/export.
- Navigate from a clash to both elements, isolate the pair, show penetration or
  clearance measurements, and retain the decision as report evidence.

### 12. Export gridlines to all required storeys

Official guidance:
[Gridline export](https://info.corenet.gov.sg/ifc-sg/modelling---authoring/GeneralModellingPractices/exportgridlinesallstorey)

Gridlines should use consistent names, be associated with every required
storey, be enabled in IFC export, appear at multiple levels in an IFC viewer,
and align across disciplines.

**Coverage: Partial**

Current workflow:

- Inspect grid geometry and data manually when the exporter and parser expose
  it.
- Filter or inspect `IfcGrid` items where available.
- Verify storey coverage and cross-discipline alignment in an external tool.

Recommended features:

- Audit `IfcGrid` and `IfcGridAxis` presence, axis names, duplicate labels,
  malformed axes, and spatial associations.
- Compare expected storeys with the storeys on which grids are available.
- Provide per-storey grid isolation and a cross-discipline grid overlay with
  position and orientation differences.
- Permit safe naming or existing-relationship repair only after a preview and
  IFC integrity check. Never synthesize missing grid geometry automatically.

## Target practitioner workflow

The target workflow should be consistent regardless of whether sources are
local or server-backed:

1. **Create a project package.** Add separate IFC files and assign discipline,
   block, site, package role, and version. COREY may suggest values but the user
   confirms them.
2. **Select the submission profile.** Choose gateway, agencies, disciplines,
   and an immutable requirement-pack version.
3. **Scan locally.** Build per-model audit snapshots and run element, model, and
   package checks without uploading local files.
4. **Review the Readiness Center.** Group issues by the 12 practices, source
   requirement, severity, model, discipline, block, and disposition.
5. **Inspect evidence.** Select an issue to focus the relevant row, spatial
   node, element, model pair, grid, origin, or clash in the viewport.
6. **Resolve or hand off.** Apply a previewable repair when eligible; otherwise
   copy or export exact authoring-tool instructions and affected identifiers.
7. **Reload and recheck.** Replace corrected files, preserve issue history, and
   distinguish resolved, introduced, accepted, and still-open issues.
8. **Export evidence.** Produce a human-readable HTML report suitable for
   printing to PDF and a machine-readable JSON report containing the profile,
   source versions, file hashes, results, dispositions, repairs, and timestamps.

## Product and engineering architecture

### Keep two checking layers

The current `ViewerValidationRule` model is appropriate for one element, one
field, and one constraint. It should remain backward-compatible.

Do not overload it with cross-row, model-wide, cross-file, or geometry rules.
Add a second audit layer and unify both layers only at the result level:

```text
Existing element clauses ----\
                              +--> ReadinessIssue[] --> Readiness Center/report
Model and package audits -----/
```

### Proposed public contracts

`SubmissionProfile`

- Selected gateway, agencies, and disciplines.
- Active requirement-pack id and version.
- Project-specific naming conventions and labelled heuristic tolerances.

`RequirementPack`

- Immutable id, version, source URLs, import date, and source hashes.
- Normalized mapping rows and curated applicability/source references.
- Model, package, and clash policies that cannot be expressed as element
  clauses.

`ProjectPackage`

- Package id and name.
- Separate model source references with discipline, block, site, role, and
  version.
- Selected submission profile and persisted issue dispositions.

`ModelAuditSnapshot`

- File identity and hash.
- Spatial hierarchy and storeys.
- IFC entity/subtype/property summaries.
- CRS, map conversion, contexts, units, placements, and bounds.
- GUID index, grids, performance metrics, and geometry summary.

`ReadinessIssue`

- Stable issue fingerprint and requirement/source reference.
- Element, model, or package scope.
- Severity, status, evidence, affected model/element references, and suggested
  action.
- Repair eligibility and the reason a repair is or is not safe.

`RepairPlan`

- Ordered operations with original and proposed values.
- Expected affected entities and relationships.
- Risk warnings, validation gates, undo data, and final export result.

### Runtime boundaries

- Keep package orchestration, Readiness Center state, filters, and repair
  previews in `ViewerShell` and regular React components.
- Keep That Open lifecycle, multi-model rendering, alignment visuals, and clash
  highlighting within `IfcViewport`.
- Run headless IFC extraction and audits in workers. The UI consumes typed
  progress and result messages instead of parsing IFC itself.
- Extend the existing model-source boundary for package members rather than
  coupling package logic to local `File` objects or server ids.
- Cache audit snapshots by content hash for stored versions. Local files remain
  browser-only unless the user explicitly uploads them.
- Persist local package metadata in browser storage and provide an exportable
  package manifest that contains metadata and hashes, not private IFC bytes.

## Delivery roadmap

### Phase 0: Strengthen today's workflow

- Publish starter clauses for storey names, GUID presence/format, entity/subtype
  combinations, and common IFC+SG properties.
- Clearly document which practices still require authoring or external
  coordination tools.
- Label the existing BCA column/beam template as partial and source-version it.

### Phase 1: Single-model Readiness Center

- Add requirement-pack import and submission-profile selection.
- Add site/storey, subtype, GUID, file-performance, and grid audits.
- Normalize current clause failures into `ReadinessIssue` results.
- Add evidence navigation, eligible metadata repairs, rescan, and report export.

This phase provides the greatest near-term practitioner value without requiring
multi-model WebGL lifecycle changes.

### Phase 2: Project packages and cross-file audits

- Add package manifests and model-role assignment.
- Run block, storey, geo-reference, cross-file GUID, grid, and bounding-box
  comparisons from model snapshots.
- Preserve the current single-model viewport while package results mature.

### Phase 3: Federation and coordination

- Add federated loading and per-model controls.
- Add alignment visualizations and cross-model issue navigation.
- Add rule-driven clash detection, dispositions, viewpoints, and BCF exchange.

### Phase 4: Advanced assisted repair

- Expand repair only for operations proven safe by representative IFC2X3 and
  IFC4 round-trip fixtures.
- Consider selected spatial or geo-reference metadata repair only after
  preflight can prove that placements, geometry, inverses, and identities remain
  correct.
- Continue refusing entity-class conversion, coordinate transformations,
  placement moves, missing geometry generation, and automatic clash resolution.

## Risks and guardrails

### Regulatory currency

Requirements change independently of application releases. Every issue and
report must carry the exact requirement-pack version. Updating a pack must not
rewrite historical results.

### Source licensing and redistribution

Official workbooks and glossary/COP content should be user- or
administrator-supplied unless redistribution rights are confirmed. COREY may
store normalized metadata and source references according to applicable rights,
but should not silently scrape or republish controlled source content.

### False confidence

Distinguish among:

- an explicit official rule;
- a project-configured policy;
- a COREY diagnostic heuristic; and
- an informational observation.

Reports must preserve that distinction. A green result means that the configured
checks passed, not that a submission is guaranteed to be accepted.

### Repair integrity

Every repair must:

- show a before/after preview;
- preserve an undo record;
- operate on a copy until export;
- reopen the resulting IFC;
- rescan affected checks;
- verify unaffected GUIDs and geometry; and
- report skipped or failed operations rather than partially hiding failure.

### Performance and privacy

Large-model checks need cancellation, progress, worker isolation, bounded
memory, and cached snapshots. Local-first scans must never upload model bytes or
derived sensitive data without an explicit user action.

## Acceptance scenarios

Use synthetic, redistributable IFC fixtures wherever possible.

### Single-model checks

- Two storeys with the same name at different elevations are flagged.
- Two storeys at the same elevation with different names are flagged according
  to the selected naming profile.
- A block file containing zero or two `IfcSite` objects fails its cardinality
  check.
- A mapping row with a missing SGPset/property, wrong unit/type, or invalid
  controlled value produces source-linked evidence.
- `USERDEFINED` without the required `ObjectType`, and a predefined value used
  where a mapping requires `USERDEFINED`, both fail.
- Missing, malformed, and duplicated GUIDs are distinguished.
- Files at 799 MB and 801 MB exercise the published recommendation boundary
  without affecting an independent server upload limit.
- Grids missing from a required storey are reported with the affected axes and
  storey.

### Package checks

- Architectural, structural, and MEP files with matching storey names and
  elevations pass; a 20 mm discrepancy fails while a sub-tolerance discrepancy
  is shown as a heuristic match.
- Mismatched CRS, True North, unit, scale, or map-conversion values identify the
  exact files and raw values.
- A GUID duplicated across two otherwise valid files is reported once as a
  package issue with both occurrences.
- Missing or duplicate block/package roles are reported before federation.

### Federation and clashes

- Aligned files overlay without a COREY-applied correction transform.
- Misaligned files show the measured offset and source-coordinate discrepancy.
- Clash fixtures cover pass, alert, and fail classifications from a versioned
  rule matrix.
- An accepted clash requires a rationale and remains distinguishable from a
  geometric pass or a resolved clash.

### Repairs and compatibility

- Eligible metadata edits reopen as valid IFC and pass the corresponding recheck.
- Undo restores the original values.
- Unaffected GUIDs, relationships, and geometry hashes remain stable.
- Duplicate-GUID repair emits an old-to-new identity map.
- Local and server-backed scans of the same bytes and requirement pack produce
  the same normalized findings.
- Existing validation configs, local single-model loading, Excel round trips,
  and stored-model version comparison continue to work unchanged.

## Decision summary

- Product role: submission-readiness checker with safe assisted IFC repair.
- Model direction: staged project packages and multi-model federation.
- Near-term priority: requirement packs and dedicated single-model audits.
- Rule architecture: retain element clauses; add a separate model/package audit
  engine with unified readiness results.
- Repair default: metadata where integrity is demonstrable; authoring handoff for
  entity, placement, coordinate-transform, grid-geometry, and clash changes.
- Compliance statement: evidence-backed readiness, never guaranteed approval.
