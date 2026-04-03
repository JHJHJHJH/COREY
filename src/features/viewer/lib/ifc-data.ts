import type { ItemAttribute, ItemData, SpatialTreeItem } from "@thatopen/fragments";
import type * as OBC from "@thatopen/components";
import type { ViewerCategorySummary, ViewerSelection, ViewerTreeNode } from "@/features/viewer/types";

type NameMap = Map<number, string>;
type CategoryMap = Map<number, string | null>;

function isItemAttribute(value: ItemAttribute | ItemData[]): value is ItemAttribute {
  return typeof value === "object" && value !== null && "value" in value;
}

function readAttribute(data: ItemData, key: string) {
  const value = data[key];

  if (!value || Array.isArray(value) || !isItemAttribute(value)) {
    return null;
  }

  return value.value;
}

function buildLabel(
  localId: number | null,
  category: string | null,
  names: NameMap,
  fallback: string,
) {
  if (localId !== null) {
    const named = names.get(localId);

    if (typeof named === "string" && named.trim().length > 0) {
      return named;
    }
  }

  if (category) {
    return category;
  }

  if (localId !== null) {
    return `#${localId}`;
  }

  return fallback;
}

function collectLocalIds(node: SpatialTreeItem, collector: Set<number>) {
  if (node.localId !== null) {
    collector.add(node.localId);
  }

  for (const child of node.children ?? []) {
    collectLocalIds(child, collector);
  }
}

function toTreeNode(
  modelId: string,
  node: SpatialTreeItem,
  names: NameMap,
  fallback: string,
): ViewerTreeNode {
  const localId = node.localId;
  const label = buildLabel(localId, node.category, names, fallback);
  const key =
    localId === null
      ? `${modelId}:virtual:${label.replaceAll(/\s+/g, "-").toLowerCase()}`
      : `${modelId}:${localId}`;

  return {
    key,
    localId,
    category: node.category,
    label,
    children: (node.children ?? []).map((child) => toTreeNode(modelId, child, names, fallback)),
  };
}

export async function buildViewerTree(
  model: {
    modelId: string;
    getItemsData: (
      ids: number[],
      config?: {
        attributesDefault: boolean;
        relationsDefault: { attributes: boolean; relations: boolean };
      },
    ) => Promise<ItemData[]>;
    getSpatialStructure: () => Promise<SpatialTreeItem>;
  },
  fallbackRootLabel: string,
) {
  const spatialTree = await model.getSpatialStructure();
  const localIds = new Set<number>();
  collectLocalIds(spatialTree, localIds);

  const orderedIds = [...localIds];
  const items = await model.getItemsData(orderedIds, {
    attributesDefault: true,
    relationsDefault: { attributes: false, relations: false },
  });

  const names = new Map<number, string>();
  for (const [index, localId] of orderedIds.entries()) {
    const item = items[index];
    if (!item) continue;

    const name = readAttribute(item, "Name") ?? readAttribute(item, "ObjectType");
    if (typeof name === "string" && name.trim().length > 0) {
      names.set(localId, name);
    }
  }

  return [toTreeNode(model.modelId, spatialTree, names, fallbackRootLabel)];
}

export function getPrimarySelection(modelIdMap: OBC.ModelIdMap, labels: NameMap, categories: CategoryMap) {
  for (const [modelId, localIds] of Object.entries(modelIdMap)) {
    for (const localId of localIds) {
      const label = labels.get(localId) ?? `#${localId}`;

      return {
        modelId,
        localId,
        label,
        category: categories.get(localId) ?? null,
      } satisfies ViewerSelection;
    }
  }

  return null;
}

export function countItems(map: OBC.ModelIdMap | null | undefined) {
  if (!map) {
    return 0;
  }

  let total = 0;
  for (const localIds of Object.values(map)) {
    total += localIds.size;
  }
  return total;
}

export function buildSingleItemMap(modelId: string, localId: number): OBC.ModelIdMap {
  return {
    [modelId]: new Set([localId]),
  };
}

export async function buildCategorySummary(
  model: {
    getItemsWithGeometryCategories: () => Promise<(string | null)[]>;
    getItemsOfCategories: (categories: RegExp[]) => Promise<Record<string, number[]>>;
  },
) {
  const categories = await model.getItemsWithGeometryCategories();
  const uniqueCategories = [...new Set(categories.filter((value): value is string => Boolean(value)))].sort();

  const summary: ViewerCategorySummary[] = [];
  for (const category of uniqueCategories) {
    const matched = await model.getItemsOfCategories([new RegExp(`^${category}$`)]);
    const count = Object.values(matched).reduce((total, ids) => total + ids.length, 0);
    summary.push({ category, count });
  }

  return summary;
}

export function readNameMaps(data: ItemData, localId: number, labels: NameMap, categories: CategoryMap) {
  const labelCandidate = readAttribute(data, "Name") ?? readAttribute(data, "ObjectType");
  const categoryCandidate = readAttribute(data, "type");

  if (typeof labelCandidate === "string" && labelCandidate.trim()) {
    labels.set(localId, labelCandidate);
  }

  if (typeof categoryCandidate === "string" && categoryCandidate.trim()) {
    categories.set(localId, categoryCandidate);
  }
}

export function formatBytes(value: number) {
  if (value === 0) {
    return "0 B";
  }

  const units = ["B", "KB", "MB", "GB"];
  const exponent = Math.min(Math.floor(Math.log(value) / Math.log(1024)), units.length - 1);
  const amount = value / 1024 ** exponent;

  return `${amount.toFixed(amount >= 100 || exponent === 0 ? 0 : 1)} ${units[exponent]}`;
}

export function formatTreeNodeCount(nodes: ViewerTreeNode[]) {
  let count = 0;

  const visit = (node: ViewerTreeNode) => {
    count += 1;
    for (const child of node.children) {
      visit(child);
    }
  };

  for (const node of nodes) {
    visit(node);
  }

  return count;
}

export function filterTree(nodes: ViewerTreeNode[], query: string): ViewerTreeNode[] {
  const trimmed = query.trim().toLowerCase();
  if (!trimmed) {
    return nodes;
  }

  const prune = (node: ViewerTreeNode): ViewerTreeNode | null => {
    const children = node.children
      .map((child) => prune(child))
      .filter((child): child is ViewerTreeNode => child !== null);

    if (node.label.toLowerCase().includes(trimmed) || children.length > 0) {
      return {
        ...node,
        children,
      };
    }

    return null;
  };

  return nodes
    .map((node) => prune(node))
    .filter((node): node is ViewerTreeNode => node !== null);
}
