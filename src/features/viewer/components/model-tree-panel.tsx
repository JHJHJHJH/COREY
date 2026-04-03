"use client";

import { useDeferredValue, useMemo, useState } from "react";
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
  depth: number;
  selection: ViewerSelection | null;
  expandedKeys: Set<string>;
  onToggle: (key: string) => void;
  onSelectNode: (localId: number) => void;
};

function TreeNodeRow({
  node,
  depth,
  selection,
  expandedKeys,
  onToggle,
  onSelectNode,
}: TreeNodeRowProps) {
  const hasChildren = node.children.length > 0;
  const expanded = hasChildren ? expandedKeys.has(node.key) : false;
  const selected = selection?.localId === node.localId;

  return (
    <div>
      <div
        className={`flex items-center gap-2 rounded-xl px-2 py-1 text-sm transition ${
          selected
            ? "bg-[color:var(--surface-strong)] text-[color:var(--foreground)]"
            : "text-[color:var(--muted-ink)] hover:bg-[color:var(--surface-soft)] hover:text-[color:var(--foreground)]"
        }`}
        style={{ paddingLeft: `${depth * 14 + 8}px` }}
      >
        <button
          type="button"
          onClick={() => hasChildren && onToggle(node.key)}
          disabled={!hasChildren}
          className="flex h-6 w-6 items-center justify-center rounded-lg text-xs text-[color:var(--muted-ink)] transition hover:bg-[color:var(--surface-strong)] disabled:cursor-default disabled:opacity-30"
          aria-label={expanded ? "Collapse node" : "Expand node"}
        >
          {hasChildren ? (expanded ? "−" : "+") : "•"}
        </button>
        <button
          type="button"
          disabled={node.localId === null}
          onClick={() => node.localId !== null && onSelectNode(node.localId)}
          className="flex min-w-0 flex-1 items-center justify-between gap-2 rounded-lg px-2 py-1 text-left disabled:cursor-default"
        >
          <span className="truncate font-medium">{node.label}</span>
          {node.category ? (
            <span className="hidden rounded-full border border-[color:var(--viewer-border)] px-2 py-0.5 text-[10px] uppercase tracking-[0.18em] text-[color:var(--muted-ink)] md:inline-flex">
              {node.category}
            </span>
          ) : null}
        </button>
      </div>

      {expanded
        ? node.children.map((child) => (
            <TreeNodeRow
              key={child.key}
              node={child}
              depth={depth + 1}
              selection={selection}
              expandedKeys={expandedKeys}
              onToggle={onToggle}
              onSelectNode={onSelectNode}
            />
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
  const [expandedKeys, setExpandedKeys] = useState<Set<string>>(new Set(nodes.map((node) => node.key)));
  const deferredQuery = useDeferredValue(query);

  const filteredNodes = useMemo(() => filterTree(nodes, deferredQuery), [deferredQuery, nodes]);

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

  return (
    <aside
      className={`flex h-full min-h-0 flex-col overflow-hidden ${
        embedded
          ? "bg-[color:var(--panel-bg)]/92"
          : "rounded-[1.75rem] border border-[color:var(--viewer-border)] bg-[color:var(--panel-bg)] shadow-[var(--viewer-shadow)]"
      }`}
    >
      <div className="border-b border-[color:var(--viewer-border)] px-5 py-4">
        <div className="text-xs font-semibold uppercase tracking-[0.18em] text-[color:var(--muted-ink)]">
          Model Tree
        </div>
        <h2 className="mt-2 text-lg font-semibold text-[color:var(--foreground)]">
          {metadata?.name ?? "No IFC loaded"}
        </h2>
        <div className="mt-2 flex flex-wrap gap-2 text-xs text-[color:var(--muted-ink)]">
          {metadata ? <span>{formatBytes(metadata.size)}</span> : null}
          <span>{stats.nodeCount} nodes</span>
          <span>{stats.categoryCount} categories</span>
        </div>
        <label className="mt-4 block">
          <span className="sr-only">Search tree</span>
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Filter names or IFC classes"
            className="w-full rounded-2xl border border-[color:var(--viewer-border)] bg-[color:var(--surface-soft)] px-4 py-3 text-sm text-[color:var(--foreground)] outline-none transition placeholder:text-[color:var(--muted-ink)] focus:border-[color:var(--accent)]"
          />
        </label>
      </div>

      <div className="grid min-h-0 flex-1 gap-4 overflow-y-auto px-5 py-4">
        <section>
          <div className="mb-2 text-xs font-semibold uppercase tracking-[0.18em] text-[color:var(--muted-ink)]">
            Categories
          </div>
          <div className="flex flex-wrap gap-2">
            {categories.slice(0, 12).map((category) => (
              <div
                key={category.category}
                className="inline-flex items-center gap-1 rounded-full border border-[color:var(--viewer-border)] bg-[color:var(--surface-soft)] px-2 py-1"
              >
                <span className="text-xs font-medium text-[color:var(--foreground)]">
                  {category.category}
                </span>
                <span className="text-[10px] uppercase tracking-[0.16em] text-[color:var(--muted-ink)]">
                  {category.count}
                </span>
                <button
                  type="button"
                  onClick={() => onHideCategory(category.category)}
                  className="rounded-full px-1 text-[10px] font-semibold uppercase tracking-[0.14em] text-[color:var(--muted-ink)] transition hover:bg-[color:var(--surface-strong)] hover:text-[color:var(--foreground)]"
                >
                  Hide
                </button>
                <button
                  type="button"
                  onClick={() => onIsolateCategory(category.category)}
                  className="rounded-full px-1 text-[10px] font-semibold uppercase tracking-[0.14em] text-[color:var(--muted-ink)] transition hover:bg-[color:var(--surface-strong)] hover:text-[color:var(--foreground)]"
                >
                  Iso
                </button>
              </div>
            ))}
          </div>
        </section>

        <section>
          <div className="mb-2 text-xs font-semibold uppercase tracking-[0.18em] text-[color:var(--muted-ink)]">
            Nodes
          </div>
          <div className="space-y-1">
            {filteredNodes.length === 0 && nodes.length === 0 && !deferredQuery ? (
              <div className="rounded-2xl border border-dashed border-[color:var(--viewer-border)] px-4 py-6 text-sm text-[color:var(--muted-ink)]">
                {metadata ? "Indexing model tree..." : "Load a model to populate the tree."}
              </div>
            ) : filteredNodes.length === 0 ? (
              <div className="rounded-2xl border border-dashed border-[color:var(--viewer-border)] px-4 py-6 text-sm text-[color:var(--muted-ink)]">
                No nodes match the current filter.
              </div>
            ) : (
              filteredNodes.map((node) => (
                <TreeNodeRow
                  key={node.key}
                  node={node}
                  depth={0}
                  selection={selection}
                  expandedKeys={expandedKeys}
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
