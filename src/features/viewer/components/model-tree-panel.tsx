"use client";

import { useDeferredValue, useEffect, useMemo, useRef, useState } from "react";
import { filterTree, formatBytes, formatTreeNodeCount } from "@/features/viewer/lib/ifc-data";
import type {
  ModelMetadata,
  ViewerCategorySummary,
  ViewerSelection,
  ViewerTreeNode,
} from "@/features/viewer/types";

type ModelTreePanelProps = {
  embedded?: boolean;
  metadata: ModelMetadata | null;
  categories: ViewerCategorySummary[];
  nodes: ViewerTreeNode[];
  selection: ViewerSelection | null;
  onSelectNode: (localId: number) => void;
  onHideCategory: (category: string) => void;
  onIsolateCategory: (category: string) => void;
};

type TreeNodeRowProps = {
  node: ViewerTreeNode;
  selection: ViewerSelection | null;
  expandedKeys: Set<string>;
  forceExpanded: boolean;
  onToggle: (key: string) => void;
  onSelectNode: (localId: number) => void;
};

function ChevronIcon({ expanded }: { expanded: boolean }) {
  return (
    <svg
      viewBox="0 0 20 20"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      className={`h-3.5 w-3.5 transition ${expanded ? "rotate-90" : ""}`}
      aria-hidden="true"
    >
      <path d="m7 4 6 6-6 6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function FilterIcon({ active }: { active: boolean }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      className={`h-4 w-4 ${active ? "text-[color:var(--accent)]" : ""}`}
      aria-hidden="true"
    >
      <path d="M4 6h16" strokeLinecap="round" />
      <path d="M7 12h10" strokeLinecap="round" />
      <path d="M10 18h4" strokeLinecap="round" />
    </svg>
  );
}

function SearchIcon({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      className={className}
      aria-hidden="true"
    >
      <circle cx="11" cy="11" r="6.5" />
      <path d="m16 16 4 4" strokeLinecap="round" />
    </svg>
  );
}

function collectExpandableKeys(nodes: ViewerTreeNode[]) {
  const keys = new Set<string>();

  const visit = (node: ViewerTreeNode) => {
    if (node.children.length > 0) {
      keys.add(node.key);
      for (const child of node.children) {
        visit(child);
      }
    }
  };

  for (const node of nodes) {
    visit(node);
  }

  return keys;
}

function TreeNodeRow({
  node,
  selection,
  expandedKeys,
  forceExpanded,
  onToggle,
  onSelectNode,
}: TreeNodeRowProps) {
  const hasChildren = node.children.length > 0;
  const expanded = hasChildren ? expandedKeys.has(node.key) : false;
  const showChildren = hasChildren && (forceExpanded || expanded);
  const selected = selection?.localId === node.localId;

  return (
    <div className="space-y-0.5">
      <div
        className={`flex items-center gap-1.5 rounded-lg border px-1.5 py-1 text-[13px] transition ${
          selected
            ? "border-[color:var(--accent)]/40 bg-[color:var(--surface-strong)] text-[color:var(--foreground)]"
            : "border-transparent text-[color:var(--muted-ink)] hover:border-[color:var(--viewer-border)] hover:bg-[color:var(--surface-soft)] hover:text-[color:var(--foreground)]"
        }`}
        role="treeitem"
        aria-expanded={hasChildren ? showChildren : undefined}
        aria-selected={selected}
      >
        <button
          type="button"
          onClick={() => hasChildren && onToggle(node.key)}
          disabled={!hasChildren}
          className="flex h-5 w-5 shrink-0 items-center justify-center rounded-md text-xs text-[color:var(--muted-ink)] transition hover:bg-[color:var(--surface-strong)] disabled:cursor-default disabled:opacity-40"
          aria-label={showChildren ? "Collapse node" : "Expand node"}
        >
          {hasChildren ? <ChevronIcon expanded={showChildren} /> : <span className="text-[11px]">•</span>}
        </button>
        <button
          type="button"
          disabled={node.localId === null}
          onClick={() => node.localId !== null && onSelectNode(node.localId)}
          className="flex min-w-0 flex-1 items-center justify-between gap-1.5 rounded-md px-1.5 py-0.5 text-left disabled:cursor-default"
        >
          <span className="truncate font-medium">{node.label}</span>
          {node.category ? (
            <span className="hidden rounded-full border border-[color:var(--viewer-border)] bg-[color:var(--panel-bg)] px-1.5 py-0.5 text-[9px] uppercase tracking-[0.14em] text-[color:var(--muted-ink)] md:inline-flex">
              {node.category}
            </span>
          ) : null}
        </button>
      </div>

      {showChildren
        ? node.children.map((child) => (
            <div
              key={child.key}
              className="ml-2 border-l border-[color:var(--viewer-border)]/80 pl-2"
            >
              <TreeNodeRow
                node={child}
                selection={selection}
                expandedKeys={expandedKeys}
                forceExpanded={forceExpanded}
                onToggle={onToggle}
                onSelectNode={onSelectNode}
              />
            </div>
          ))
        : null}
    </div>
  );
}

export function ModelTreePanel({
  embedded = false,
  metadata,
  categories,
  nodes,
  selection,
  onSelectNode,
  onHideCategory,
  onIsolateCategory,
}: ModelTreePanelProps) {
  const [query, setQuery] = useState("");
  const [showSearch, setShowSearch] = useState(false);
  const [expandedKeys, setExpandedKeys] = useState<Set<string>>(() => collectExpandableKeys(nodes));
  const [selectedCategories, setSelectedCategories] = useState<Set<string> | null>(null);
  const [showCategoryFilter, setShowCategoryFilter] = useState(false);
  const deferredQuery = useDeferredValue(query);
  const filterMenuRef = useRef<HTMLDivElement | null>(null);
  const searchInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    setExpandedKeys(collectExpandableKeys(nodes));
  }, [nodes]);

  useEffect(() => {
    if (showSearch) {
      searchInputRef.current?.focus();
    }
  }, [showSearch]);

  useEffect(() => {
    if (!showCategoryFilter) {
      return undefined;
    }

    const handlePointerDown = (event: PointerEvent) => {
      if (filterMenuRef.current?.contains(event.target as Node)) {
        return;
      }

      setShowCategoryFilter(false);
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setShowCategoryFilter(false);
      }
    };

    document.addEventListener("pointerdown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);

    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [showCategoryFilter]);

  const categoryNames = useMemo(() => categories.map((entry) => entry.category), [categories]);

  useEffect(() => {
    setSelectedCategories((current) => {
      if (current === null) {
        return null;
      }

      const next = new Set(categoryNames.filter((category) => current.has(category)));
      if (next.size === 0 || next.size === categoryNames.length) {
        return null;
      }

      return next;
    });
  }, [categoryNames]);

  const hasActiveCategoryFilter = selectedCategories !== null;
  const activeCategoryCount = selectedCategories?.size ?? categories.length;

  const filteredNodes = useMemo(
    () => filterTree(nodes, deferredQuery, selectedCategories),
    [deferredQuery, nodes, selectedCategories],
  );
  const effectiveExpandedKeys = useMemo(
    () =>
      deferredQuery.trim() || hasActiveCategoryFilter
        ? collectExpandableKeys(filteredNodes)
        : expandedKeys,
    [deferredQuery, expandedKeys, filteredNodes, hasActiveCategoryFilter],
  );

  const stats = useMemo(
    () => ({
      nodeCount: formatTreeNodeCount(nodes),
      categoryCount: categories.length,
    }),
    [categories.length, nodes],
  );

  const toggleNode = (key: string) => {
    setExpandedKeys((current) => {
      const next = new Set(current);
      if (next.has(key)) {
        next.delete(key);
      } else {
        next.add(key);
      }
      return next;
    });
  };

  const toggleCategoryFilter = (category: string) => {
    setSelectedCategories((current) => {
      if (categoryNames.length === 0) {
        return null;
      }

      const next = current === null ? new Set(categoryNames) : new Set(current);

      if (next.has(category)) {
        next.delete(category);
      } else {
        next.add(category);
      }

      if (next.size === categoryNames.length) {
        return null;
      }

      return next;
    });
  };

  const filterSummary = hasActiveCategoryFilter
    ? `${activeCategoryCount} of ${categories.length} categories`
    : "All categories";
  const forceExpanded = Boolean(deferredQuery.trim() || hasActiveCategoryFilter);

  const collapseSearch = () => {
    if (query.trim().length === 0) {
      setShowSearch(false);
    }
  };

  return (
    <aside
      className={`flex h-full min-h-0 flex-col overflow-hidden ${
        embedded
          ? "bg-[color:var(--panel-bg)]/92"
          : "rounded-[1.75rem] border border-[color:var(--viewer-border)] bg-[color:var(--panel-bg)] shadow-[var(--viewer-shadow)]"
      }`}
    >
      <div className="border-b border-[color:var(--viewer-border)] px-3 py-3">
        <div className="text-xs font-semibold uppercase tracking-[0.18em] text-[color:var(--muted-ink)]">
          Model Tree
        </div>
        <h2 className="mt-1.5 text-base font-semibold text-[color:var(--foreground)]">
          {metadata?.name ?? "No IFC loaded"}
        </h2>
        <div className="mt-1.5 flex flex-wrap gap-x-2 gap-y-1 text-[11px] text-[color:var(--muted-ink)]">
          {metadata ? <span>{formatBytes(metadata.size)}</span> : null}
          <span>{stats.nodeCount} nodes</span>
          <span>{stats.categoryCount} categories</span>
        </div>
        <div className="mt-3 flex items-start gap-1.5">
          {showSearch || query ? (
            <label className="relative min-w-0 flex-1">
              <span className="sr-only">Search tree</span>
              <SearchIcon className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-[color:var(--muted-ink)]" />
              <input
                ref={searchInputRef}
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                onBlur={collapseSearch}
                onKeyDown={(event) => {
                  if (event.key === "Escape") {
                    if (query.trim().length === 0) {
                      setShowSearch(false);
                    }
                    searchInputRef.current?.blur();
                  }
                }}
                placeholder="Filter names or IFC classes"
                className="w-full rounded-xl border border-[color:var(--viewer-border)] bg-[color:var(--surface-soft)] py-2 pl-8 pr-3 text-[13px] text-[color:var(--foreground)] outline-none transition placeholder:text-[color:var(--muted-ink)] focus:border-[color:var(--accent)]"
              />
            </label>
          ) : (
            <button
              type="button"
              aria-label="Search tree"
              onClick={() => setShowSearch(true)}
              className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-[color:var(--viewer-border)] bg-[color:var(--surface-soft)] text-[color:var(--muted-ink)] transition hover:bg-[color:var(--surface-strong)] hover:text-[color:var(--foreground)]"
            >
              <SearchIcon className="h-4 w-4" />
            </button>
          )}
          <div className="relative shrink-0" ref={filterMenuRef}>
            <button
              type="button"
              aria-label="Filter categories"
              aria-expanded={showCategoryFilter}
              onClick={() => setShowCategoryFilter((current) => !current)}
              className={`relative flex h-10 w-10 items-center justify-center rounded-xl border bg-[color:var(--surface-soft)] transition ${
                hasActiveCategoryFilter
                  ? "border-[color:var(--accent)]/50"
                  : "border-[color:var(--viewer-border)] hover:bg-[color:var(--surface-strong)]"
              }`}
            >
              <FilterIcon active={hasActiveCategoryFilter} />
              {hasActiveCategoryFilter ? (
                <span className="absolute -right-1 -top-1 inline-flex min-h-5 min-w-5 items-center justify-center rounded-full bg-[color:var(--accent)] px-1 text-[10px] font-semibold text-[color:var(--accent-ink)]">
                  {activeCategoryCount}
                </span>
              ) : null}
            </button>

            {showCategoryFilter ? (
              <div className="absolute right-0 top-full z-20 mt-1.5 w-[min(20rem,calc(100vw-2rem))] rounded-2xl border border-[color:var(--viewer-border)] bg-[color:var(--panel-bg)] p-2.5 shadow-[var(--viewer-shadow)]">
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <div className="text-xs font-semibold uppercase tracking-[0.18em] text-[color:var(--muted-ink)]">
                      Category Filter
                    </div>
                    <div className="mt-0.5 text-[11px] text-[color:var(--muted-ink)]">{filterSummary}</div>
                  </div>
                  <button
                    type="button"
                    onClick={() => setSelectedCategories(null)}
                    className="rounded-full border border-[color:var(--viewer-border)] px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.14em] text-[color:var(--muted-ink)] transition hover:bg-[color:var(--surface-soft)] hover:text-[color:var(--foreground)]"
                  >
                    Reset
                  </button>
                </div>

                <div className="mt-2 max-h-72 space-y-0.5 overflow-y-auto pr-0.5 [scrollbar-width:none] [-ms-overflow-style:none] [&::-webkit-scrollbar]:hidden">
                  {categories.length === 0 ? (
                    <div className="rounded-xl border border-dashed border-[color:var(--viewer-border)] px-2.5 py-3 text-[13px] text-[color:var(--muted-ink)]">
                      Load a model to filter categories.
                    </div>
                  ) : (
                    categories.map((category) => {
                      const checked =
                        selectedCategories === null || selectedCategories.has(category.category);

                      return (
                        <div
                          key={category.category}
                          className="flex items-center gap-1.5 rounded-xl border border-transparent px-1.5 py-1.5 hover:border-[color:var(--viewer-border)] hover:bg-[color:var(--surface-soft)]"
                        >
                          <label className="flex min-w-0 flex-1 items-center gap-2">
                            <input
                              type="checkbox"
                              checked={checked}
                              onChange={() => toggleCategoryFilter(category.category)}
                              className="h-4 w-4 rounded border-[color:var(--viewer-border)] text-[color:var(--accent)] focus:ring-0"
                            />
                            <span className="min-w-0 flex-1 truncate text-[13px] font-medium text-[color:var(--foreground)]">
                              {category.category}
                            </span>
                          </label>
                          <span className="rounded-full border border-[color:var(--viewer-border)] px-1.5 py-0.5 text-[9px] uppercase tracking-[0.12em] text-[color:var(--muted-ink)]">
                            {category.count}
                          </span>
                          <button
                            type="button"
                            onClick={() => onHideCategory(category.category)}
                            className="rounded-full px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-[0.12em] text-[color:var(--muted-ink)] transition hover:bg-[color:var(--surface-strong)] hover:text-[color:var(--foreground)]"
                          >
                            Hide
                          </button>
                          <button
                            type="button"
                            onClick={() => onIsolateCategory(category.category)}
                            className="rounded-full px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-[0.12em] text-[color:var(--muted-ink)] transition hover:bg-[color:var(--surface-strong)] hover:text-[color:var(--foreground)]"
                          >
                            Iso
                          </button>
                        </div>
                      );
                    })
                  )}
                </div>
              </div>
            ) : null}
          </div>
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-3 py-3 [scrollbar-width:none] [-ms-overflow-style:none] [&::-webkit-scrollbar]:hidden">
        <section>
          <div className="mb-2 flex items-center justify-between gap-2">
            <div className="text-xs font-semibold uppercase tracking-[0.18em] text-[color:var(--muted-ink)]">
              Tree
            </div>
            <div className="text-[10px] uppercase tracking-[0.14em] text-[color:var(--muted-ink)]">
              {filterSummary}
            </div>
          </div>
          <div role="tree" className="space-y-1">
            {filteredNodes.length === 0 && nodes.length === 0 && !deferredQuery ? (
              <div className="rounded-xl border border-dashed border-[color:var(--viewer-border)] px-3 py-4 text-[13px] text-[color:var(--muted-ink)]">
                {metadata ? "Indexing model tree..." : "Load a model to populate the tree."}
              </div>
            ) : filteredNodes.length === 0 ? (
              <div className="rounded-xl border border-dashed border-[color:var(--viewer-border)] px-3 py-4 text-[13px] text-[color:var(--muted-ink)]">
                No nodes match the current filter.
              </div>
            ) : (
              filteredNodes.map((node) => (
                <TreeNodeRow
                  key={node.key}
                  node={node}
                  selection={selection}
                  expandedKeys={effectiveExpandedKeys}
                  forceExpanded={forceExpanded}
                  onToggle={toggleNode}
                  onSelectNode={onSelectNode}
                />
              ))
            )}
          </div>
        </section>
      </div>
    </aside>
  );
}
