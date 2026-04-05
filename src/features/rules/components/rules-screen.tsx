"use client";

import Link from "next/link";
import { useRef, useState, type ChangeEvent } from "react";
import { useViewerRules } from "@/features/rules/rules-provider";
import {
  createEmptyViewerValidationConfig,
  parseViewerValidationConfigText,
  serializeViewerValidationConfig,
} from "@/features/rules/lib/validation";
import type {
  ViewerValidationCheck,
  ViewerValidationRule,
} from "@/features/viewer/types";

type RulesScreenProps = {
  mode: "modal" | "page";
  onClose?: () => void;
};

const STARTER_TEMPLATES = [
  {
    id: "testmodel-simple",
    name: "Testmodel Simple",
    description: "2 slab checks for GlobalId and SGPset_Slab > ReferTo2DDetail to force demo highlights.",
    href: "/resources/testmodel-rules-simple.json",
    ruleCount: 2,
  },
  {
    id: "testmodel-comprehensive",
    name: "Testmodel Comprehensive",
    description: "67 mixed-severity rules for IfcSlab, IfcColumn, and IfcBeam with broad expected highlights.",
    href: "/resources/testmodel-rules-comprehensive.json",
    ruleCount: 67,
  },
] as const;

function inputClassName() {
  return "w-full rounded-2xl border border-[color:var(--viewer-border)] bg-[color:var(--surface-soft)] px-3 py-2.5 text-sm text-[color:var(--foreground)] outline-none transition focus:border-[color:var(--accent)]";
}

function labelClassName() {
  return "mb-1.5 block text-[11px] font-semibold uppercase tracking-[0.16em] text-[color:var(--muted-ink)]";
}

function secondaryButtonClassName() {
  return "rounded-2xl border border-[color:var(--viewer-border)] bg-[color:var(--surface-soft)] px-3 py-2 text-sm font-medium text-[color:var(--foreground)] transition hover:bg-[color:var(--surface-strong)]";
}

function enumText(check: ViewerValidationCheck) {
  return check.kind === "enum" ? check.allowedValues.join(", ") : "";
}

function numberValue(value: number | null) {
  return value === null ? "" : String(value);
}

function nextCheckForKind(kind: ViewerValidationCheck["kind"]): ViewerValidationCheck {
  if (kind === "empty") {
    return { kind: "empty" };
  }

  if (kind === "enum") {
    return {
      kind: "enum",
      allowedValues: ["Allowed Value"],
    };
  }

  return {
    kind: "numberRange",
    min: null,
    max: null,
  };
}

function parseEnumValues(value: string) {
  return value
    .split(/[\n,]/)
    .map((entry) => entry.trim())
    .filter(Boolean);
}

function RuleCard({
  rule,
  onChange,
  onRemove,
}: {
  rule: ViewerValidationRule;
  onChange: (rule: ViewerValidationRule) => void;
  onRemove: () => void;
}) {
  const propertyTarget = rule.target.kind === "property" ? rule.target : null;
  const numberRangeCheck = rule.check.kind === "numberRange" ? rule.check : null;

  return (
    <section className="rounded-[1.5rem] border border-[color:var(--viewer-border)] bg-white/65 p-4 shadow-[0_12px_30px_rgba(10,48,128,0.08)]">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <label>
            <span className={labelClassName()}>IFC Type</span>
            <input
              value={rule.ifcType}
              onChange={(event) => onChange({ ...rule, ifcType: event.target.value })}
              className={inputClassName()}
              placeholder="IFCWALL"
            />
          </label>
        </div>

        <div className="w-full min-w-[12rem] sm:w-auto sm:min-w-[11rem]">
          <label>
            <span className={labelClassName()}>Fail Severity</span>
            <select
              value={rule.failSeverity}
              onChange={(event) =>
                onChange({
                  ...rule,
                  failSeverity: event.target.value as ViewerValidationRule["failSeverity"],
                })
              }
              className={inputClassName()}
            >
              <option value="error">Error</option>
              <option value="warn">Warn</option>
            </select>
          </label>
        </div>

        <button type="button" onClick={onRemove} className={secondaryButtonClassName()}>
          Remove
        </button>
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-[minmax(0,12rem)_minmax(0,1fr)_minmax(0,1fr)]">
        <label>
          <span className={labelClassName()}>Target Kind</span>
          <select
            value={rule.target.kind}
            onChange={(event) => {
              const kind = event.target.value as ViewerValidationRule["target"]["kind"];
              onChange({
                ...rule,
                target:
                  kind === "attribute"
                    ? { kind: "attribute", name: "Name" }
                    : { kind: "property", group: "Pset_WallCommon", label: "Reference" },
              });
            }}
            className={inputClassName()}
          >
            <option value="attribute">Attribute</option>
            <option value="property">Property</option>
          </select>
        </label>

        {rule.target.kind === "attribute" ? (
          <label className="lg:col-span-2">
            <span className={labelClassName()}>Attribute Name</span>
            <input
              value={rule.target.name}
              onChange={(event) =>
                onChange({
                  ...rule,
                  target: {
                    kind: "attribute",
                    name: event.target.value,
                  },
                })
              }
              className={inputClassName()}
              placeholder="Name"
            />
          </label>
        ) : propertyTarget ? (
          <>
            <label>
              <span className={labelClassName()}>Property Set</span>
              <input
                value={propertyTarget.group}
                onChange={(event) =>
                  onChange({
                    ...rule,
                    target: {
                      kind: "property",
                      label: propertyTarget.label,
                      group: event.target.value,
                    },
                  })
                }
                className={inputClassName()}
                placeholder="Pset_WallCommon"
              />
            </label>

            <label>
              <span className={labelClassName()}>Property Label</span>
              <input
                value={propertyTarget.label}
                onChange={(event) =>
                  onChange({
                    ...rule,
                    target: {
                      kind: "property",
                      group: propertyTarget.group,
                      label: event.target.value,
                    },
                  })
                }
                className={inputClassName()}
                placeholder="Reference"
              />
            </label>
          </>
        ) : null}
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-[minmax(0,12rem)_minmax(0,1fr)_minmax(0,1fr)]">
        <label>
          <span className={labelClassName()}>Check</span>
          <select
            value={rule.check.kind}
            onChange={(event) =>
              onChange({
                ...rule,
                check: nextCheckForKind(event.target.value as ViewerValidationCheck["kind"]),
              })
            }
            className={inputClassName()}
          >
            <option value="empty">Required value</option>
            <option value="enum">Enum</option>
            <option value="numberRange">Number range</option>
          </select>
        </label>

        {rule.check.kind === "enum" ? (
          <label className="lg:col-span-2">
            <span className={labelClassName()}>Allowed Values</span>
            <textarea
              rows={3}
              value={enumText(rule.check)}
              onChange={(event) =>
                onChange({
                  ...rule,
                  check: {
                    kind: "enum",
                    allowedValues: parseEnumValues(event.target.value),
                  },
                })
              }
              className={inputClassName()}
              placeholder="A, B, C"
            />
          </label>
        ) : numberRangeCheck ? (
          <>
            <label>
              <span className={labelClassName()}>Minimum</span>
              <input
                type="number"
                value={numberValue(numberRangeCheck.min)}
                onChange={(event) =>
                  onChange({
                    ...rule,
                    check: {
                      kind: "numberRange",
                      max: numberRangeCheck.max,
                      min: event.target.value === "" ? null : Number(event.target.value),
                    },
                  })
                }
                className={inputClassName()}
                placeholder="0"
              />
            </label>

            <label>
              <span className={labelClassName()}>Maximum</span>
              <input
                type="number"
                value={numberValue(numberRangeCheck.max)}
                onChange={(event) =>
                  onChange({
                    ...rule,
                    check: {
                      kind: "numberRange",
                      min: numberRangeCheck.min,
                      max: event.target.value === "" ? null : Number(event.target.value),
                    },
                  })
                }
                className={inputClassName()}
                placeholder="100"
              />
            </label>
          </>
        ) : (
          <div className="lg:col-span-2 rounded-2xl border border-[color:var(--viewer-border)] bg-[color:var(--surface-soft)] px-3 py-3 text-sm text-[color:var(--muted-ink)]">
            The value must exist and must not be missing, empty, null, or undefined.
          </div>
        )}
      </div>
    </section>
  );
}

export function RulesScreen({ mode, onClose }: RulesScreenProps) {
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const { config, addRule, removeRule, replaceConfig, updateRule } = useViewerRules();
  const [importError, setImportError] = useState<string | null>(null);
  const [loadingTemplateId, setLoadingTemplateId] = useState<string | null>(null);

  const handleExport = () => {
    const blob = new Blob([serializeViewerValidationConfig(config)], {
      type: "application/json",
    });
    const href = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = href;
    anchor.download = "corey-rules.json";
    anchor.click();
    URL.revokeObjectURL(href);
  };

  const handleImport = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) {
      return;
    }

    try {
      const importedConfig = parseViewerValidationConfigText(await file.text());
      replaceConfig(importedConfig);
      setImportError(null);
    } catch (error) {
      setImportError(error instanceof Error ? error.message : "Rules JSON could not be imported.");
    } finally {
      event.target.value = "";
    }
  };

  const handleLoadStarterTemplate = async (template: (typeof STARTER_TEMPLATES)[number]) => {
    try {
      setLoadingTemplateId(template.id);

      const response = await fetch(template.href, {
        cache: "no-store",
      });

      if (!response.ok) {
        throw new Error(`Starter template could not be loaded (${response.status}).`);
      }

      const importedConfig = parseViewerValidationConfigText(await response.text());
      replaceConfig(importedConfig);
      setImportError(null);
    } catch (error) {
      setImportError(
        error instanceof Error ? error.message : "Starter template could not be loaded.",
      );
    } finally {
      setLoadingTemplateId(null);
    }
  };

  return (
    <section
      className={`flex min-h-0 flex-col overflow-hidden rounded-[1.75rem] border border-[color:var(--viewer-border)] bg-[color:var(--panel-bg)] shadow-[var(--viewer-shadow)] ${
        mode === "modal" ? "h-full" : "min-h-[calc(100vh-5rem)]"
      }`}
    >
      <div className="border-b border-[color:var(--viewer-border)] bg-[linear-gradient(135deg,rgba(255,255,255,0.98),rgba(234,242,255,0.94))] px-5 py-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="text-[11px] font-semibold uppercase tracking-[0.22em] text-[color:var(--muted-ink)]">
              COREY Rules
            </div>
            <h1 className="mt-1 text-xl font-semibold tracking-tight text-[color:var(--foreground)]">
              Validation rules workspace
            </h1>
            <p className="mt-2 max-w-3xl text-sm leading-6 text-[color:var(--muted-ink)]">
              Configure per-entity checks for required values, enums, and numeric ranges. Passing
              rows show as ok, failing rows show as warn or error based on the selected rule.
            </p>
          </div>

          <div className="flex items-center gap-2">
            {mode === "page" ? (
              <Link href="/" className={secondaryButtonClassName()}>
                Open COREY
              </Link>
            ) : null}
            {mode === "modal" && onClose ? (
              <button type="button" onClick={onClose} className={secondaryButtonClassName()}>
                Close
              </button>
            ) : null}
          </div>
        </div>

        <div className="mt-4 flex flex-wrap items-center gap-2 text-xs text-[color:var(--muted-ink)]">
          <span className="rounded-full border border-[color:var(--viewer-border)] bg-white/70 px-3 py-1.5">
            {config.rules.length} rules
          </span>
          <span className="rounded-full border border-[color:var(--viewer-border)] bg-white/70 px-3 py-1.5">
            Auto-saved locally
          </span>
        </div>
      </div>

      <div className="border-b border-[color:var(--viewer-border)] px-5 py-4">
        <div className="flex flex-wrap items-center gap-2">
          <input
            ref={fileInputRef}
            type="file"
            accept="application/json,.json"
            onChange={handleImport}
            className="hidden"
          />
          <button type="button" onClick={addRule} className={secondaryButtonClassName()}>
            Add rule
          </button>
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            className={secondaryButtonClassName()}
          >
            Import JSON
          </button>
          <button type="button" onClick={handleExport} className={secondaryButtonClassName()}>
            Export JSON
          </button>
          <button
            type="button"
            onClick={() => replaceConfig(createEmptyViewerValidationConfig())}
            className={secondaryButtonClassName()}
          >
            Clear all
          </button>
        </div>

        {importError ? (
          <div className="mt-3 rounded-2xl border border-[#c78972] bg-[#fff0ea] px-3 py-2 text-sm text-[#8a3e1f]">
            {importError}
          </div>
        ) : null}

        <div className="mt-4 grid gap-3 lg:grid-cols-2">
          {STARTER_TEMPLATES.map((template) => {
            const isLoading = loadingTemplateId === template.id;

            return (
              <section
                key={template.id}
                className="rounded-[1.5rem] border border-[color:var(--viewer-border)] bg-white/55 px-4 py-4"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-[color:var(--muted-ink)]">
                      Starter Template
                    </div>
                    <h2 className="mt-1 text-base font-semibold text-[color:var(--foreground)]">
                      {template.name}
                    </h2>
                    <p className="mt-2 text-sm leading-6 text-[color:var(--muted-ink)]">
                      {template.description}
                    </p>
                  </div>

                  <span className="shrink-0 rounded-full border border-[color:var(--viewer-border)] bg-white/75 px-3 py-1 text-xs font-medium text-[color:var(--muted-ink)]">
                    {template.ruleCount} rules
                  </span>
                </div>

                <div className="mt-4 flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    onClick={() => void handleLoadStarterTemplate(template)}
                    disabled={loadingTemplateId !== null}
                    className={`${secondaryButtonClassName()} disabled:cursor-wait disabled:opacity-60`}
                  >
                    {isLoading ? "Loading..." : "Load template"}
                  </button>
                  <a
                    href={template.href}
                    download
                    className={secondaryButtonClassName()}
                  >
                    Download JSON
                  </a>
                </div>
              </section>
            );
          })}
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-5 py-5">
        {config.rules.length === 0 ? (
          <div className="rounded-[1.5rem] border border-dashed border-[color:var(--viewer-border)] bg-white/45 px-6 py-8 text-center">
            <div className="text-xs font-semibold uppercase tracking-[0.18em] text-[color:var(--muted-ink)]">
              No Rules Yet
            </div>
            <div className="mt-3 text-lg font-semibold text-[color:var(--foreground)]">
              Add your first IFC validation rule
            </div>
            <p className="mt-2 text-sm leading-6 text-[color:var(--muted-ink)]">
              Rules are global to this browser profile and can be exported as JSON for reuse.
            </p>
          </div>
        ) : (
          <div className="space-y-4">
            {config.rules.map((rule) => (
              <RuleCard
                key={rule.id}
                rule={rule}
                onChange={(nextRule) => updateRule(rule.id, nextRule)}
                onRemove={() => removeRule(rule.id)}
              />
            ))}
          </div>
        )}
      </div>
    </section>
  );
}
