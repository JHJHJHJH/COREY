# Graph View UX Optimization Implementation Plan

> **For Hermes:** Use subagent-driven-development skill to implement this plan task-by-task.

**Goal:** Improve the IFC relationship graph so search, selection, and inspection feel guided and readable instead of visually overwhelming.

**Architecture:** Keep Cytoscape as the rendering engine, but shift the graph surface into explicit UX modes: overview, search-results exploration, and selected-node focus. Add a small derived UI state layer in the graph component to manage result navigation, summary chips, and stronger focus hierarchy without changing the core graph data model.

**Tech Stack:** Next.js 16, React 19, Cytoscape.js, Tailwind CSS 4, existing viewer shell + properties panel components.

---

## Product Direction

Implement these product changes in order:

1. **Search becomes guided exploration**
   - Auto-focus the first result.
   - Add previous/next match controls.
   - Show a compact result summary bar.
   - Separate selected result vs other matches vs non-matches visually.

2. **Selected node becomes the visual anchor**
   - Stronger selected-node styling.
   - Fade unrelated graph context.
   - Keep direct neighbors readable.

3. **Properties panel becomes insight-first**
   - Add a top summary block for selected node.
   - Hide low-value empty rows by default.
   - Add graph-context information (match count, direct link count, parent container if available).

4. **Overview layout becomes tighter and better fit**
   - Improve fit/padding defaults for small graphs.
   - Ensure sparse graphs do not look stranded in whitespace.

---

## Files Likely Involved

- Modify: `src/features/viewer/components/element-relationship-graph.tsx`
- Modify: `src/features/viewer/components/properties-panel.tsx`
- Modify: `src/features/viewer/components/viewer-shell.tsx`
- Modify: `src/features/viewer/types.ts`
- Optional create: `src/features/viewer/lib/graph-view-ux.ts`

---

## Task 1: Add explicit graph UX state for search matches and active match navigation

**Objective:** Create lightweight UI state that supports guided movement through search results.

**Files:**
- Modify: `src/features/viewer/components/element-relationship-graph.tsx`
- Optional create: `src/features/viewer/lib/graph-view-ux.ts`

**Step 1: Introduce derived search-result state**

Add derived values for:
- `matchedNodeKeys`
- `activeMatchIndex`
- `activeMatchNodeKey`
- `totalMatchCount`

Keep this state local to the graph component unless other surfaces need it.

**Step 2: Default active match when search changes**

When the search term changes and matches exist:
- set active match to index 0
- reset to `null` when there are no matches

**Step 3: Add previous/next handlers**

Create handlers:
- `handlePreviousMatch()`
- `handleNextMatch()`

Wrap around at both ends.

**Step 4: Focus graph on active match**

When `activeMatchNodeKey` changes:
- fit the graph to that node with comfortable padding
- apply selected-like emphasis to the active match
- do **not** rerun full layout

**Step 5: Verify manually**

Run:
```bash
pnpm dev
```

Expected:
- typing `wall` sets active match 1 of N
- previous/next cycles through results
- graph focus updates without jarring relayout

**Step 6: Commit**

```bash
git add src/features/viewer/components/element-relationship-graph.tsx src/features/viewer/lib/graph-view-ux.ts

git commit -m "feat: add guided graph search match navigation"
```

---

## Task 2: Add a search result summary bar and make search state actionable

**Objective:** Make search results understandable before the user manually clicks around.

**Files:**
- Modify: `src/features/viewer/components/element-relationship-graph.tsx`

**Step 1: Add a compact summary row near the graph header**

Show:
- `N matches`
- `Match X of N` when active match exists
- optional count of visible compounds/groups if already available

**Step 2: Add buttons for key actions**

Add small labeled controls:
- `Prev`
- `Next`
- `Fit results`
- `Clear search`

Do not add too many controls; keep them in one grouped cluster.

**Step 3: Improve empty/zero-result search state**

If search has no matches, show a stronger message than the current passive state.

Suggested copy:
- `No matches for “{term}”. Try IFC class, local ID, or partial element name.`

**Step 4: Verify manually**

Expected:
- search produces an obvious summary
- next/prev feel like the primary way to inspect results
- zero-result state is clearly explained

**Step 5: Commit**

```bash
git add src/features/viewer/components/element-relationship-graph.tsx

git commit -m "feat: add actionable graph search summary bar"
```

---

## Task 3: Strengthen visual hierarchy for selected node, active match, neighbors, and background

**Objective:** Make graph state immediately legible in dense views.

**Files:**
- Modify: `src/features/viewer/components/element-relationship-graph.tsx`

**Step 1: Introduce clearer Cytoscape classes**

Ensure distinct classes exist for:
- `selected-node`
- `active-match-node`
- `matched-node`
- `context-node`
- `deemphasized-node`
- matching edge classes for selected path / direct-neighbor emphasis

**Step 2: Update styling rules**

Suggested visual hierarchy:
- selected node: largest border, brightest fill, visible label
- active match: strong but secondary to selected
- direct neighbors: medium emphasis
- unrelated nodes: reduced opacity
- unrelated edges: much lighter opacity

**Step 3: Apply focus+context behavior**

On node select:
- keep direct neighbors readable
- fade second-order/unrelated nodes
- preserve enough context to understand placement

**Step 4: Add a tiny legend or state chips**

Example chips:
- `Selected`
- `Active match`
- `Related`

This can be visual-only and lightweight.

**Step 5: Verify manually**

Expected:
- selected node is unmistakable in dense search results
- active match is understandable even before selection
- graph stops feeling like a single undifferentiated cluster

**Step 6: Commit**

```bash
git add src/features/viewer/components/element-relationship-graph.tsx

git commit -m "feat: improve graph state hierarchy and focus context"
```

---

## Task 4: Improve overview fit for sparse graphs

**Objective:** Prevent small graphs from looking marooned in excessive whitespace.

**Files:**
- Modify: `src/features/viewer/components/element-relationship-graph.tsx`

**Step 1: Detect sparse overview state**

Use a simple heuristic such as:
- node count <= 8
- no active search
- no active selection

**Step 2: Apply tighter fit defaults**

For sparse overview:
- reduce fit padding
- slightly tighten ideal edge length / spacing
- ensure graph centers in the usable canvas area

**Step 3: Avoid harming grouped graphs**

Keep existing grouped spring layout behavior for compound/group-heavy states.
Do not regress the preferred top-down + spring compromise.

**Step 4: Verify manually**

Expected:
- 4-node overview fills the graph area more gracefully
- labels are easier to read
- graph feels intentionally composed

**Step 5: Commit**

```bash
git add src/features/viewer/components/element-relationship-graph.tsx

git commit -m "feat: tighten sparse graph overview layout"
```

---

## Task 5: Make labels adaptive instead of uniformly noisy

**Objective:** Improve readability without showing every label at all times.

**Files:**
- Modify: `src/features/viewer/components/element-relationship-graph.tsx`

**Step 1: Always show labels for high-priority nodes**

High-priority nodes:
- selected node
- active match
- direct neighbors
- maybe top-level structural ancestors

**Step 2: Reduce label noise for low-priority nodes**

Options:
- smaller label opacity
- abbreviated labels
- show on hover only
- hide when zoom level is low

Choose the simplest option that works reliably with Cytoscape.

**Step 3: Add hover/title support if needed**

If some labels are hidden or shortened, provide full text on hover.

**Step 4: Verify manually**

Expected:
- dense graphs become easier to scan
- key nodes remain readable
- overview labels no longer feel cramped

**Step 5: Commit**

```bash
git add src/features/viewer/components/element-relationship-graph.tsx

git commit -m "feat: add adaptive graph label visibility"
```

---

## Task 6: Upgrade the properties panel into an insight-first inspector

**Objective:** Make the side panel help interpretation, not just dump raw IFC fields.

**Files:**
- Modify: `src/features/viewer/components/properties-panel.tsx`
- Modify: `src/features/viewer/types.ts`
- Modify: `src/features/viewer/components/viewer-shell.tsx`

**Step 1: Add a selected-node summary section**

At the top of the properties panel show:
- IFC class badge
- human-readable name / mark
- local ID
- optional graph summary metadata

**Step 2: Add graph-context metadata to panel props**

Pass lightweight summary values such as:
- direct relationship count
- is search match
- parent/group/storey label if known

Do not over-couple the panel to Cytoscape internals.

**Step 3: Hide empty values by default**

Instead of rendering many `Empty string` rows:
- suppress them, or
- collapse behind a `Show empty attributes` toggle

**Step 4: Reorder sections by usefulness**

Suggested order:
1. summary
2. key attributes
3. graph context
4. property sets
5. raw identifiers / low-level metadata

**Step 5: Verify manually**

Expected:
- selected wall is easier to understand at a glance
- panel feels curated rather than raw
- fewer noisy empty-value rows

**Step 6: Commit**

```bash
git add src/features/viewer/components/properties-panel.tsx src/features/viewer/types.ts src/features/viewer/components/viewer-shell.tsx

git commit -m "feat: make properties panel insight first for graph selection"
```

---

## Task 7: Reduce noisy production console output around graph usage

**Objective:** Improve QA/debug signal and reduce avoidable runtime noise.

**Files:**
- Modify: relevant viewer/graph/runtime files after source discovery

**Step 1: Remove or gate verbose production logs**

Audit repeated logs such as:
- `Fragments: Zero length geometry: ...`

If needed, guard them behind development-only checks.

**Step 2: Investigate wheel sensitivity warning source**

If this is intentionally configured, either:
- adjust it to a natural value, or
- document why it must remain custom

**Step 3: Investigate deprecated Three.js API usage**

Replace deprecated clock/timer usage if it exists in app-controlled code.
If it comes from a dependency, document it and track dependency upgrade path.

**Step 4: Verify manually**

Expected:
- production console is materially quieter
- remaining warnings are either unavoidable dependency warnings or genuinely actionable

**Step 5: Commit**

```bash
git add [relevant files]

git commit -m "chore: reduce graph runtime console noise"
```

---

## Verification Checklist

Run:
```bash
pnpm lint
pnpm build
```

Manual verification:
- Load bundled `testmodel.ifc`
- Open graph viewport with sparse default state
- Confirm overview fit looks balanced
- Search `wall`
- Confirm active match summary appears
- Use next/previous match controls
- Select an active match
- Confirm selected node stands out strongly
- Confirm unrelated graph content is deemphasized
- Confirm properties panel shows insight-first summary and hides empty-value noise
- Confirm production console output is cleaner than before

---

## Acceptance Criteria

- Sparse overview feels intentionally fitted and readable.
- Search results no longer feel like an undirected graph explosion.
- Users can navigate matches sequentially.
- Selected node is visually dominant in dense result states.
- Properties panel helps interpretation with summary + context.
- Console noise is reduced in production.

---

## Notes for Implementer

- Preserve the existing selection wiring into the properties panel.
- Do **not** rerun full layouts on pure selection/highlight changes.
- Keep grouped/compound layout behavior compatible with the existing Cytoscape strategy and user preference for spring/group layouts with top-down readability.
- Favor small, incremental UX improvements over a total graph rewrite.
