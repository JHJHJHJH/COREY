"use client";

import Link from "next/link";
import { Trash2, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState, type ChangeEvent } from "react";
import { useViewerRules } from "@/features/rules/rules-provider";
import {
  createEmptyViewerValidationConfig,
  parseViewerValidationConfigText,
  serializeViewerValidationConfig,
} from "@/features/rules/lib/validation";
import {
  listRuleTemplates,
  readRuleTemplate,
  ruleTemplateConfigEndpoint,
  ruleTemplateSourceEndpoint,
} from "@/features/rules/lib/rule-template-api";
import type {
  ViewerRuleTemplateSummary,
  ViewerValidationCheck,
  ViewerValidationClause,
  ViewerValidationRule,
} from "@/features/viewer/types";

type RulesScreenProps = {
  mode: "modal" | "page";
  onClose?: () => void;
};

function inputClassName() {
  return "w-full rounded-xl border border-[color:var(--viewer-border)] bg-[color:var(--surface-soft)] px-2.5 py-2 text-sm text-[color:var(--foreground)] outline-none transition focus:border-[color:var(--accent)] disabled:cursor-not-allowed disabled:bg-[color:var(--panel-bg)] disabled:text-[color:var(--muted-ink)] disabled:opacity-80";
}

function secondaryButtonClassName() {
  return "rounded-2xl border border-[color:var(--viewer-border)] bg-[color:var(--surface-soft)] px-3 py-2 text-sm font-medium text-[color:var(--foreground)] transition hover:bg-[color:var(--surface-strong)]";
}

function compactButtonClassName() {
  return "inline-flex h-8 items-center justify-center rounded-xl border border-[color:var(--viewer-border)] bg-[color:var(--surface-soft)] px-2.5 text-xs font-medium text-[color:var(--foreground)] transition hover:bg-[color:var(--surface-strong)]";
}

function canDownloadTemplateSource(template: ViewerRuleTemplateSummary) {
  return (
    Boolean(template.sourceFileName) &&
    template.templateId !== "industry-mapping-bca-column-beam" &&
    template.name !== "BCA - Column + Beam"
  );
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

function headerCellClassName(widthClassName: string) {
  return `${widthClassName} border-b border-[color:var(--viewer-border)] bg-[color:var(--panel-bg)] px-3 py-3 align-bottom`;
}

function bodyCellClassName(widthClassName: string, subdued = false) {
  return `${widthClassName} border-b border-[color:var(--viewer-border)] px-3 py-3 align-top ${subdued ? "bg-[color:var(--panel-bg)]/45" : "bg-white/45"}`;
}

function EnumValuesInput({
  check,
  disabled,
  onCommit,
}: {
  check: ViewerValidationCheck;
  disabled: boolean;
  onCommit: (allowedValues: string[]) => void;
}) {
  const serializedValue = enumText(check);
  const [draftValue, setDraftValue] = useState(serializedValue);
  const previewValues = disabled ? [] : parseEnumValues(draftValue);

  useEffect(() => {
    setDraftValue(serializedValue);
  }, [serializedValue]);

  return (
    <div className="space-y-2">
      <input
        type="text"
        value={draftValue}
        onChange={(event) => setDraftValue(event.target.value)}
        onBlur={() => onCommit(parseEnumValues(draftValue))}
        className={inputClassName()}
        placeholder="A, B, C"
        aria-label="Allowed values"
        disabled={disabled}
      />
      <div className="flex min-h-6 flex-wrap gap-1">
        {previewValues.length > 0 ? (
          previewValues.map((value) => (
            <span
              key={value}
              className="rounded-full border border-[color:var(--viewer-border)] bg-[color:var(--surface-soft)] px-2 py-0.5 text-[11px] font-medium text-[color:var(--foreground)]"
            >
              {value}
            </span>
          ))
        ) : (
          <span className="text-[11px] text-[color:var(--muted-ink)]">Comma-separated values</span>
        )}
      </div>
    </div>
  );
}

function RuleRow({
  rule,
  onChange,
  onRemove,
}: {
  rule: ViewerValidationRule;
  onChange: (rule: ViewerValidationRule) => void;
  onRemove: () => void;
}) {
  const attributeTarget = rule.target.kind === "attribute" ? rule.target : null;
  const propertyTarget = rule.target.kind === "property" ? rule.target : null;
  const numberRangeCheck = rule.check.kind === "numberRange" ? rule.check : null;
  const isAttributeTarget = rule.target.kind === "attribute";
  const isPropertyTarget = rule.target.kind === "property";
  const isEnumCheck = rule.check.kind === "enum";
  const isNumberRangeCheck = rule.check.kind === "numberRange";

  return (
    <tr className="transition hover:bg-white/25">
      <td className={bodyCellClassName("min-w-[12rem]")}>
        <input
          value={rule.ifcType}
          onChange={(event) => onChange({ ...rule, ifcType: event.target.value })}
          className={inputClassName()}
          placeholder="IFCWALL"
          aria-label="IFC type"
        />
      </td>
      <td className={bodyCellClassName("min-w-[9rem]")}>
        <select
          value={rule.failSeverity}
          onChange={(event) =>
            onChange({
              ...rule,
              failSeverity: event.target.value as ViewerValidationRule["failSeverity"],
            })
          }
          className={inputClassName()}
          aria-label="Fail severity"
        >
          <option value="error">Error</option>
          <option value="warn">Warn</option>
        </select>
      </td>
      <td className={bodyCellClassName("min-w-[10rem]")}>
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
          aria-label="Target kind"
        >
          <option value="attribute">Attribute</option>
          <option value="property">Property</option>
        </select>
      </td>
      <td className={bodyCellClassName("min-w-[12rem]", !isAttributeTarget)}>
        <input
          value={attributeTarget?.name ?? ""}
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
          aria-label="Attribute name"
          disabled={!isAttributeTarget}
        />
      </td>
      <td className={bodyCellClassName("min-w-[13rem]", !isPropertyTarget)}>
        <input
          value={propertyTarget?.group ?? ""}
          onChange={(event) =>
            onChange({
              ...rule,
              target: {
                kind: "property",
                group: event.target.value,
                label: propertyTarget?.label ?? "Reference",
              },
            })
          }
          className={inputClassName()}
          placeholder="Pset_WallCommon"
          aria-label="Property set"
          disabled={!isPropertyTarget}
        />
      </td>
      <td className={bodyCellClassName("min-w-[12rem]", !isPropertyTarget)}>
        <input
          value={propertyTarget?.label ?? ""}
          onChange={(event) =>
            onChange({
              ...rule,
              target: {
                kind: "property",
                group: propertyTarget?.group ?? "Pset_WallCommon",
                label: event.target.value,
              },
            })
          }
          className={inputClassName()}
          placeholder="Reference"
          aria-label="Property label"
          disabled={!isPropertyTarget}
        />
      </td>
      <td className={bodyCellClassName("min-w-[11rem]")}>
        <select
          value={rule.check.kind}
          onChange={(event) =>
            onChange({
              ...rule,
              check: nextCheckForKind(event.target.value as ViewerValidationCheck["kind"]),
            })
          }
          className={inputClassName()}
          aria-label="Check kind"
        >
          <option value="empty">Required value</option>
          <option value="enum">Enum</option>
          <option value="numberRange">Number range</option>
        </select>
      </td>
      <td className={bodyCellClassName("min-w-[16rem]", !isEnumCheck)}>
        <EnumValuesInput
          check={rule.check}
          disabled={!isEnumCheck}
          onCommit={(allowedValues) =>
            onChange({
              ...rule,
              check: {
                kind: "enum",
                allowedValues,
              },
            })
          }
        />
      </td>
      <td className={bodyCellClassName("min-w-[8rem]", !isNumberRangeCheck)}>
        <input
          type="number"
          value={numberValue(numberRangeCheck?.min ?? null)}
          onChange={(event) =>
            onChange({
              ...rule,
              check: {
                kind: "numberRange",
                max: numberRangeCheck?.max ?? null,
                min: event.target.value === "" ? null : Number(event.target.value),
              },
            })
          }
          className={inputClassName()}
          placeholder="0"
          aria-label="Minimum value"
          disabled={!isNumberRangeCheck}
        />
      </td>
      <td className={bodyCellClassName("min-w-[8rem]", !isNumberRangeCheck)}>
        <input
          type="number"
          value={numberValue(numberRangeCheck?.max ?? null)}
          onChange={(event) =>
            onChange({
              ...rule,
              check: {
                kind: "numberRange",
                min: numberRangeCheck?.min ?? null,
                max: event.target.value === "" ? null : Number(event.target.value),
              },
            })
          }
          className={inputClassName()}
          placeholder="100"
          aria-label="Maximum value"
          disabled={!isNumberRangeCheck}
        />
      </td>
      <td className={bodyCellClassName("min-w-[7rem]")}>
        <button
          type="button"
          onClick={onRemove}
          aria-label="Remove rule"
          title="Remove rule"
          className="flex h-10 w-10 items-center justify-center rounded-xl border border-[#d9a89d] bg-[#fff0ea] text-[#b5432f] transition hover:bg-[#ffe5dc] hover:text-[#962f1f]"
        >
          <Trash2 className="h-4 w-4" />
        </button>
      </td>
    </tr>
  );
}

function ClauseCard({
  clause,
  onChange,
  onRemove,
  onAddRule,
  onUpdateRule,
  onRemoveRule,
}: {
  clause: ViewerValidationClause;
  onChange: (clause: ViewerValidationClause) => void;
  onRemove: () => void;
  onAddRule: () => void;
  onUpdateRule: (ruleId: string, nextRule: ViewerValidationRule) => void;
  onRemoveRule: (ruleId: string) => void;
}) {
  return (
    <section className="overflow-hidden rounded-[1.5rem] border border-[color:var(--viewer-border)] bg-white/55 shadow-[0_12px_30px_rgba(10,48,128,0.08)]">
      <div className="border-b border-[color:var(--viewer-border)] bg-[color:var(--panel-bg)]/70 px-4 py-4">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
          <div className="min-w-0 flex-1">
            <div className="text-[10px] font-semibold uppercase tracking-[0.18em] text-[color:var(--muted-ink)]">
              Clause
            </div>
            <div className="mt-2 max-w-xl">
              <input
                value={clause.title}
                onChange={(event) => onChange({ ...clause, title: event.target.value })}
                className={inputClassName()}
                placeholder="Clause title"
                aria-label="Clause title"
              />
            </div>
            <div className="mt-3 flex flex-wrap items-center gap-2 text-xs text-[color:var(--muted-ink)]">
              <span className="rounded-full border border-[color:var(--viewer-border)] bg-white/70 px-3 py-1.5">
                {clause.rules.length} rules
              </span>
            </div>
          </div>

          <div className="flex shrink-0 flex-wrap items-center gap-2">
            <button type="button" onClick={onAddRule} className={compactButtonClassName()}>
              Add rule
            </button>
            <button
              type="button"
              onClick={onRemove}
              className="inline-flex h-8 items-center justify-center rounded-xl border border-[#d9a89d] bg-[#fff0ea] px-2.5 text-xs font-medium text-[#b5432f] transition hover:bg-[#ffe5dc] hover:text-[#962f1f]"
            >
              Remove clause
            </button>
          </div>
        </div>
      </div>

      {clause.rules.length === 0 ? (
        <div className="px-4 py-6 text-sm text-[color:var(--muted-ink)]">
          This clause has no rules yet.
        </div>
      ) : (
        <div className="overflow-auto">
          <table className="min-w-full border-separate border-spacing-0 text-left">
            <thead className="sticky top-0 z-10 bg-[color:var(--panel-bg)]">
              <tr>
                <th className={headerCellClassName("min-w-[12rem]")}>IFC Type</th>
                <th className={headerCellClassName("min-w-[9rem]")}>Severity</th>
                <th className={headerCellClassName("min-w-[10rem]")}>Target Kind</th>
                <th className={headerCellClassName("min-w-[12rem]")}>Attribute Name</th>
                <th className={headerCellClassName("min-w-[13rem]")}>Property Set</th>
                <th className={headerCellClassName("min-w-[12rem]")}>Property Label</th>
                <th className={headerCellClassName("min-w-[11rem]")}>Check Kind</th>
                <th className={headerCellClassName("min-w-[16rem]")}>Allowed Values</th>
                <th className={headerCellClassName("min-w-[8rem]")}>Min</th>
                <th className={headerCellClassName("min-w-[8rem]")}>Max</th>
                <th className={headerCellClassName("min-w-[7rem]")}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {clause.rules.map((rule) => (
                <RuleRow
                  key={rule.id}
                  rule={rule}
                  onChange={(nextRule) => onUpdateRule(rule.id, nextRule)}
                  onRemove={() => onRemoveRule(rule.id)}
                />
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

export function RulesScreen({ mode, onClose }: RulesScreenProps) {
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const { config, addClause, updateClause, removeClause, addRule, updateRule, removeRule, replaceConfig } =
    useViewerRules();
  const [importError, setImportError] = useState<string | null>(null);
  const [loadingTemplateId, setLoadingTemplateId] = useState<string | null>(null);
  const [starterTemplates, setStarterTemplates] = useState<ViewerRuleTemplateSummary[]>([]);
  const [templatesLoading, setTemplatesLoading] = useState(true);
  const [templatesError, setTemplatesError] = useState<string | null>(null);

  const totalRuleCount = useMemo(
    () => config.clauses.reduce((count, clause) => count + clause.rules.length, 0),
    [config.clauses],
  );

  useEffect(() => {
    const controller = new AbortController();

    setTemplatesLoading(true);
    listRuleTemplates(controller.signal)
      .then((templates) => {
        setStarterTemplates(templates);
        setTemplatesError(null);
      })
      .catch((error) => {
        if (controller.signal.aborted) {
          return;
        }

        setTemplatesError(
          error instanceof Error ? error.message : "Starter templates could not be listed.",
        );
      })
      .finally(() => {
        if (!controller.signal.aborted) {
          setTemplatesLoading(false);
        }
      });

    return () => controller.abort();
  }, []);

  const handleExport = () => {
    const blob = new Blob([serializeViewerValidationConfig(config)], {
      type: "application/json",
    });
    const href = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = href;
    anchor.download = "corey-clauses.json";
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

  const handleLoadStarterTemplate = async (template: ViewerRuleTemplateSummary) => {
    try {
      setLoadingTemplateId(template.templateId);

      const importedTemplate = await readRuleTemplate(template.templateId);
      replaceConfig(importedTemplate.config);
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
      className={`flex min-h-0 w-full flex-col overflow-hidden rounded-[1.75rem] border border-[color:var(--viewer-border)] bg-[color:var(--panel-bg)] shadow-[var(--viewer-shadow)] ${
        mode === "modal" ? "h-full" : "min-h-[calc(100vh-5rem)]"
      }`}
    >
      <div className="border-b border-[color:var(--viewer-border)] bg-[linear-gradient(135deg,rgba(255,255,255,0.98),rgba(234,242,255,0.94))] px-5 py-3">
        <div className="flex flex-col gap-3 lg:grid lg:grid-cols-[minmax(0,1fr)_minmax(44rem,56rem)] lg:items-start lg:gap-4">
          <div className="min-w-0">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="text-[11px] font-semibold uppercase tracking-[0.22em] text-[color:var(--muted-ink)]">
                  COREY Rules
                </div>
                <h1 className="mt-1 text-xl font-semibold tracking-tight text-[color:var(--foreground)]">
                  Validation clauses workspace
                </h1>
                <p className="mt-1.5 max-w-2xl text-sm leading-5 text-[color:var(--muted-ink)]">
                  Group validation rules into clauses so failed elements can report which clause and
                  which checks they broke.
                </p>
              </div>

              <div className="flex items-center gap-2">
                {mode === "page" ? (
                  <Link href="/" className={secondaryButtonClassName()}>
                    Open COREY
                  </Link>
                ) : null}
              </div>
            </div>

            <div className="mt-3 flex flex-wrap items-center gap-2 text-xs text-[color:var(--muted-ink)]">
              <span className="rounded-full border border-[color:var(--viewer-border)] bg-white/70 px-3 py-1.5">
                {config.clauses.length} clauses
              </span>
              <span className="rounded-full border border-[color:var(--viewer-border)] bg-white/70 px-3 py-1.5">
                {totalRuleCount} rules
              </span>
              <span className="rounded-full border border-[color:var(--viewer-border)] bg-white/70 px-3 py-1.5">
                Auto-saved locally
              </span>
            </div>
          </div>

          <aside className="w-full rounded-[1.2rem] border border-[color:var(--viewer-border)] bg-white/55 p-2.5 lg:justify-self-stretch">
            <div className="flex items-center justify-between gap-3">
              <div>
                <div className="text-[10px] font-semibold uppercase tracking-[0.18em] text-[color:var(--muted-ink)]">
                  Starter Templates
                </div>
                <p className="mt-0.5 text-[11px] leading-4 text-[color:var(--muted-ink)]">
                  Quick presets
                </p>
              </div>
              {mode === "modal" && onClose ? (
                <button
                  type="button"
                  aria-label="Close"
                  title="Close"
                  onClick={onClose}
                  className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl border border-[color:var(--viewer-border)] bg-[color:var(--surface-soft)] text-[color:var(--muted-ink)] transition hover:bg-[color:var(--surface-strong)] hover:text-[color:var(--foreground)]"
                >
                  <X className="h-4 w-4" />
                </button>
              ) : null}
            </div>

            <div className="mt-2 grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
              {templatesLoading ? (
                <div className="rounded-[1rem] border border-[color:var(--viewer-border)] bg-white/70 px-2.5 py-2.5 text-xs text-[color:var(--muted-ink)]">
                  Loading templates...
                </div>
              ) : templatesError ? (
                <div className="rounded-[1rem] border border-[#c78972] bg-[#fff0ea] px-2.5 py-2.5 text-xs text-[#8a3e1f]">
                  {templatesError}
                </div>
              ) : starterTemplates.length === 0 ? (
                <div className="rounded-[1rem] border border-[color:var(--viewer-border)] bg-white/70 px-2.5 py-2.5 text-xs text-[color:var(--muted-ink)]">
                  No templates available.
                </div>
              ) : (
                starterTemplates.map((template) => {
                  const isLoading = loadingTemplateId === template.templateId;

                  return (
                    <section
                      key={template.templateId}
                      className="rounded-[1rem] border border-[color:var(--viewer-border)] bg-white/70 px-2.5 py-2.5"
                    >
                      <div className="flex h-full items-start justify-between gap-3">
                        <div className="min-w-0">
                          <h2 className="text-sm font-semibold text-[color:var(--foreground)]">
                            {template.name}
                          </h2>
                          <p className="mt-0.5 text-[11px] leading-4 text-[color:var(--muted-ink)]">
                            {template.description}
                          </p>
                          <p className="mt-1 text-[11px] leading-4 text-[color:var(--muted-ink)]">
                            {template.ruleCount} rules
                          </p>
                        </div>
                        <div className="flex shrink-0 flex-wrap items-center justify-end gap-1.5 self-center">
                          <button
                            type="button"
                            onClick={() => void handleLoadStarterTemplate(template)}
                            disabled={loadingTemplateId !== null}
                            className={`${compactButtonClassName()} disabled:cursor-wait disabled:opacity-60`}
                          >
                            {isLoading ? "..." : "Load"}
                          </button>
                          <a
                            href={ruleTemplateConfigEndpoint(template.templateId)}
                            download
                            className={compactButtonClassName()}
                          >
                            JSON
                          </a>
                          {canDownloadTemplateSource(template) ? (
                            <a
                              href={ruleTemplateSourceEndpoint(template.templateId)}
                              download
                              className={compactButtonClassName()}
                            >
                              CSV
                            </a>
                          ) : null}
                        </div>
                      </div>
                    </section>
                  );
                })
              )}
            </div>
          </aside>
        </div>
      </div>

      <div className="border-b border-[color:var(--viewer-border)] px-5 py-3">
        <div className="flex flex-wrap items-center gap-2">
          <input
            ref={fileInputRef}
            type="file"
            accept="application/json,.json"
            onChange={handleImport}
            className="hidden"
          />
          <button type="button" onClick={addClause} className={secondaryButtonClassName()}>
            Add clause
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
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-5 py-5">
        {config.clauses.length === 0 ? (
          <div className="rounded-[1.5rem] border border-dashed border-[color:var(--viewer-border)] bg-white/45 px-6 py-8 text-center">
            <div className="text-xs font-semibold uppercase tracking-[0.18em] text-[color:var(--muted-ink)]">
              No Clauses Yet
            </div>
            <div className="mt-3 text-lg font-semibold text-[color:var(--foreground)]">
              Add your first validation clause
            </div>
            <p className="mt-2 text-sm leading-6 text-[color:var(--muted-ink)]">
              Clauses are global to this browser profile and export as version 2 clause-based JSON.
            </p>
          </div>
        ) : (
          <div className="space-y-4">
            {config.clauses.map((clause) => (
              <ClauseCard
                key={clause.id}
                clause={clause}
                onChange={(nextClause) => updateClause(clause.id, nextClause)}
                onRemove={() => removeClause(clause.id)}
                onAddRule={() => addRule(clause.id)}
                onUpdateRule={(ruleId, nextRule) => updateRule(clause.id, ruleId, nextRule)}
                onRemoveRule={(ruleId) => removeRule(clause.id, ruleId)}
              />
            ))}
          </div>
        )}
      </div>
    </section>
  );
}
