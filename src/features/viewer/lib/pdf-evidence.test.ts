import assert from "node:assert/strict";
import test from "node:test";
import {
  citationRectPercent,
  formatKnowledgeLocator,
} from "@/features/viewer/lib/pdf-evidence";

test("citationRectPercent expands and converts source coordinates", () => {
  assert.deepEqual(citationRectPercent([10, 20, 30, 40], 100, 200), {
    left: "7.000000000000001%",
    top: "8.5%",
    width: "26%",
    height: "13%",
  });
});

test("formatKnowledgeLocator formats PDF and workbook evidence", () => {
  assert.equal(formatKnowledgeLocator({ page: 42 }), "Page 42");
  assert.equal(
    formatKnowledgeLocator({ sheet: "CX Pilot Mapping", rowStart: 9, rowEnd: 9 }),
    "CX Pilot Mapping · row 9",
  );
  assert.equal(
    formatKnowledgeLocator({ sheet: "Space Values", rowStart: 2, rowEnd: 36 }),
    "Space Values · rows 2–36",
  );
});
