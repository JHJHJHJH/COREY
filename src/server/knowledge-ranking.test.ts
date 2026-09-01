import assert from "node:assert/strict";
import test from "node:test";
import { reciprocalRankFuse, viewerKnowledgeContextTerms } from "@/server/knowledge-ranking";

test("reciprocalRankFuse rewards agreement between semantic and keyword retrieval", () => {
  const semantic = [
    { id: "semantic-only", content: "general guidance", metadata: {} },
    { id: "both", content: "accessible route width", metadata: {} },
  ];
  const keyword = [
    { id: "both", content: "accessible route width", metadata: {} },
    { id: "keyword-only", content: "route", metadata: {} },
  ];
  const ranked = reciprocalRankFuse(semantic, keyword, []);
  assert.equal(ranked[0].id, "both");
  assert.deepEqual(new Set(ranked.map((row) => row.id)), new Set(["semantic-only", "both", "keyword-only"]));
});

test("reciprocalRankFuse boosts evidence matching IFC context", () => {
  const rows = [
    { id: "generic", content: "generic door requirement", metadata: {} },
    { id: "contextual", content: "IfcDoor USERDEFINED FireRating", metadata: {} },
  ];
  const ranked = reciprocalRankFuse(rows, [], ["ifcdoor", "firerating"]);
  assert.equal(ranked[0].id, "contextual");
});

test("viewerKnowledgeContextTerms normalizes entity, subtype, and property context", () => {
  assert.deepEqual(
    viewerKnowledgeContextTerms({
      modelId: "model",
      expressId: 42,
      label: "Door",
      ifcType: "IFCDOOR",
      subtype: " USERDEFINED ",
      properties: [{ group: "Pset_DoorCommon", name: "FireRating", value: "2 HR" }],
    }),
    ["ifcdoor", "userdefined", "pset_doorcommon", "firerating", "2 hr"],
  );
});
