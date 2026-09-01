import assert from "node:assert/strict";
import test from "node:test";
import {
  knowledgeEtagMatches,
  parseKnowledgeByteRange,
  requestedKnowledgeByteRange,
} from "@/server/knowledge-source-files";

test("parseKnowledgeByteRange supports full, open, and suffix ranges", () => {
  assert.deepEqual(parseKnowledgeByteRange("bytes=10-19", 100), { start: 10, end: 19 });
  assert.deepEqual(parseKnowledgeByteRange("bytes=90-", 100), { start: 90, end: 99 });
  assert.deepEqual(parseKnowledgeByteRange("bytes=-10", 100), { start: 90, end: 99 });
});

test("parseKnowledgeByteRange rejects malformed or impossible ranges", () => {
  assert.equal(parseKnowledgeByteRange("bytes=20-10", 100), "invalid");
  assert.equal(parseKnowledgeByteRange("items=0-5", 100), "invalid");
  assert.equal(parseKnowledgeByteRange("bytes=100-", 100), "invalid");
});

test("ETag helpers honor conditional range semantics", () => {
  const etag = '"sha256-example"';
  assert.equal(knowledgeEtagMatches(`"other", ${etag}`, etag), true);
  assert.equal(requestedKnowledgeByteRange("bytes=0-9", '"stale"', etag, 100), null);
  assert.deepEqual(requestedKnowledgeByteRange("bytes=0-9", etag, etag, 100), {
    start: 0,
    end: 9,
  });
});
