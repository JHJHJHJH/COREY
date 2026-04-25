import type {
  ViewerInspectionGroup,
  ViewerInspectionRow,
  ViewerSelectionDetails,
} from "@/features/viewer/types";

type PropertiesPanelViewModelOptions = {
  showEmptyRows: boolean;
};

type PropertiesPanelGraphContextRow = {
  label: string;
  value: string;
};

type PropertiesPanelViewModel = {
  summary: {
    ifcClass: string;
    title: string;
    localIdLabel: string;
    subtitle: string | null;
    issueCount: number;
  };
  keyAttributeRows: ViewerInspectionRow[];
  rawAttributeRows: ViewerInspectionRow[];
  graphContextRows: PropertiesPanelGraphContextRow[];
  propertySets: ViewerInspectionGroup[];
  hiddenEmptyRowCount: number;
};

const PRIORITY_ATTRIBUTE_LABELS = new Set(["Name", "Description", "ObjectType"]);
const RAW_ATTRIBUTE_LABELS = new Set(["GlobalId"]);

function isMeaningfulRow(row: ViewerInspectionRow) {
  return row.value.state === "present" && row.value.text.trim().length > 0;
}

function filterRows(rows: ReadonlyArray<ViewerInspectionRow>, showEmptyRows: boolean) {
  if (showEmptyRows) {
    return {
      rows: [...rows],
      hiddenCount: 0,
    };
  }

  const visibleRows = rows.filter(isMeaningfulRow);
  return {
    rows: visibleRows,
    hiddenCount: rows.length - visibleRows.length,
  };
}

function formatSearchStatus(input: {
  activeMatchIndex: number | null;
  matchCount: number | null;
  searchQuery: string | null;
}) {
  if (!input.searchQuery || !input.matchCount || input.matchCount <= 0) {
    return null;
  }

  if (input.activeMatchIndex !== null && input.activeMatchIndex >= 0) {
    return `Match ${input.activeMatchIndex + 1} of ${input.matchCount} for "${input.searchQuery}"`;
  }

  return `${input.matchCount} matches for "${input.searchQuery}"`;
}

export function buildPropertiesPanelViewModel(
  details: ViewerSelectionDetails,
  options: PropertiesPanelViewModelOptions,
): PropertiesPanelViewModel | null {
  if (!details.selection || !details.inspection) {
    return null;
  }

  const typeRow = details.inspection.summaryRows.find((row) => row.label === "type") ?? null;
  const globalIdRow = details.inspection.summaryRows.find((row) => row.label === "GlobalId") ?? null;
  const nameRow = details.inspection.summaryRows.find((row) => row.label === "Name") ?? null;
  const objectTypeRow = details.inspection.summaryRows.find((row) => row.label === "ObjectType") ?? null;

  const keySummaryRows = details.inspection.summaryRows.filter((row) => PRIORITY_ATTRIBUTE_LABELS.has(row.label));
  const rawSummaryRows = details.inspection.summaryRows.filter((row) => RAW_ATTRIBUTE_LABELS.has(row.label));

  const filteredKeyRows = filterRows(keySummaryRows, options.showEmptyRows);
  const filteredRawRows = filterRows(rawSummaryRows, options.showEmptyRows);

  const filteredPropertySets = details.inspection.propertySets
    .map((group) => {
      const filteredRows = filterRows(group.rows, options.showEmptyRows);
      return {
        group: {
          ...group,
          rows: filteredRows.rows,
          issueCount: filteredRows.rows.reduce((count, row) => count + Number(row.value.state !== "present"), 0) +
            Number(filteredRows.rows.length === 0),
        },
        hiddenCount: filteredRows.hiddenCount,
      };
    })
    .filter((entry) => options.showEmptyRows || entry.group.rows.length > 0);

  const searchStatus = formatSearchStatus({
    activeMatchIndex: details.inspection.graphContext?.activeMatchIndex ?? null,
    matchCount: details.inspection.graphContext?.matchCount ?? null,
    searchQuery: details.inspection.graphContext?.searchQuery ?? null,
  });

  const graphContextRows: PropertiesPanelGraphContextRow[] = [];
  if (details.inspection.graphContext) {
    graphContextRows.push({
      label: "Direct links",
      value: String(details.inspection.graphContext.directRelationshipCount),
    });
    if (details.inspection.graphContext.parentLabel) {
      graphContextRows.push({
        label: "Parent container",
        value: details.inspection.graphContext.parentLabel,
      });
    }
    graphContextRows.push({
      label: "Visible children",
      value: String(details.inspection.graphContext.childCount),
    });
    graphContextRows.push({
      label: "Nested elements",
      value: String(details.inspection.graphContext.descendantCount),
    });
    if (searchStatus) {
      graphContextRows.push({
        label: "Search status",
        value: searchStatus,
      });
    }
  }

  return {
    summary: {
      ifcClass:
        (typeRow?.value.text.trim() || details.selection.category?.trim() || details.selection.label.trim() || "Element"),
      title:
        (nameRow?.value.text.trim() ||
          details.inspection.title.trim() ||
          details.selection.label.trim() ||
          `Element #${details.selection.localId}`),
      localIdLabel: `#${details.selection.localId}`,
      subtitle: objectTypeRow?.value.text.trim() || globalIdRow?.value.text.trim() || null,
      issueCount: details.inspection.issueCount,
    },
    keyAttributeRows: filteredKeyRows.rows,
    rawAttributeRows: filteredRawRows.rows,
    graphContextRows,
    propertySets: filteredPropertySets.map((entry) => entry.group),
    hiddenEmptyRowCount:
      filteredKeyRows.hiddenCount +
      filteredRawRows.hiddenCount +
      filteredPropertySets.reduce((count, entry) => count + entry.hiddenCount, 0),
  };
}
