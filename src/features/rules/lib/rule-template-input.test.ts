import assert from "node:assert/strict";
import test from "node:test";
import {
  MAX_RULE_TEMPLATE_DESCRIPTION,
  MAX_RULE_TEMPLATE_NAME,
  parseRuleTemplateInput,
} from "@/features/rules/lib/rule-template-input";
import { defaultViewerValidationSeverities } from "@/features/rules/lib/validation";

function clause(id: string, title: string) {
  return {
    id,
    title,
    rules: [
      {
        id: `${id}-rule`,
        ifcType: "IFCWALL",
        target: { kind: "attribute", name: "Name" },
        check: { kind: "empty" },
        failSeverity: "error",
      },
    ],
  };
}

function body(overrides: Record<string, unknown> = {}) {
  return {
    name: "Fire safety",
    config: {
      version: 4,
      severities: defaultViewerValidationSeverities(),
      clauses: [clause("clause-1", "Fire rating")],
    },
    ...overrides,
  };
}

test("a valid request parses into a config template by default", () => {
  const parsed = parseRuleTemplateInput(body());

  assert.equal(parsed.name, "Fire safety");
  assert.equal(parsed.description, "");
  assert.equal(parsed.kind, "config");
  assert.equal(parsed.config.clauses.length, 1);
});

test("the name and description are trimmed", () => {
  const parsed = parseRuleTemplateInput(body({ name: "  Spaced  ", description: "  Notes  " }));

  assert.equal(parsed.name, "Spaced");
  assert.equal(parsed.description, "Notes");
});

test("a blank or whitespace-only name is rejected", () => {
  assert.throws(() => parseRuleTemplateInput(body({ name: "   " })), /needs a name/);
  assert.throws(() => parseRuleTemplateInput(body({ name: undefined })), /needs a name/);
});

test("an over-long name or description is rejected", () => {
  assert.throws(
    () => parseRuleTemplateInput(body({ name: "n".repeat(MAX_RULE_TEMPLATE_NAME + 1) })),
    /at most/,
  );
  assert.throws(
    () =>
      parseRuleTemplateInput(
        body({ description: "d".repeat(MAX_RULE_TEMPLATE_DESCRIPTION + 1) }),
      ),
    /at most/,
  );
});

test("an unknown template kind is rejected", () => {
  assert.throws(() => parseRuleTemplateInput(body({ kind: "everything" })), /must be/);
});

test("a clause template must hold exactly one clause", () => {
  const twoClauses = body({
    kind: "clause",
    config: {
      version: 4,
      severities: defaultViewerValidationSeverities(),
      clauses: [clause("clause-1", "One"), clause("clause-2", "Two")],
    },
  });

  assert.throws(() => parseRuleTemplateInput(twoClauses), /exactly one clause/);
});

test("a template with no clauses is rejected", () => {
  const empty = body({
    config: { version: 4, severities: defaultViewerValidationSeverities(), clauses: [] },
  });

  assert.throws(() => parseRuleTemplateInput(empty), /at least one clause/);
});

test("a malformed config is rejected rather than migrated", () => {
  assert.throws(() => parseRuleTemplateInput(body({ config: { version: 1, rules: [] } })), /version/);
  assert.throws(() => parseRuleTemplateInput(body({ config: "not-a-config" })), /must be an object/);
});

test("a non-object request body is rejected", () => {
  assert.throws(() => parseRuleTemplateInput("nope"), /must be an object/);
  assert.throws(() => parseRuleTemplateInput(null), /must be an object/);
});
