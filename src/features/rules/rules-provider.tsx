"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useSyncExternalStore,
  type PropsWithChildren,
} from "react";
import {
  VIEWER_VALIDATION_STORAGE_KEY,
  cloneViewerValidationClauses,
  createViewerValidationClause,
  createViewerValidationRule,
  createViewerValidationSeverity,
  createEmptyViewerValidationConfig,
  mergeViewerValidationSeverities,
  parseStoredViewerValidationConfigText,
  sanitizeViewerValidationConfig,
} from "@/features/rules/lib/validation";
import { buildViewerSeverityScale } from "@/features/viewer/lib/severity-scale";
import type {
  ViewerValidationClause,
  ViewerValidationConfig,
  ViewerValidationRule,
  ViewerValidationSeverity,
} from "@/features/viewer/types";

type ViewerRulesContextValue = {
  config: ViewerValidationConfig;
  addClause: () => void;
  updateClause: (clauseId: string, nextClause: ViewerValidationClause) => void;
  removeClause: (clauseId: string) => void;
  addRule: (clauseId: string) => void;
  updateRule: (clauseId: string, ruleId: string, nextRule: ViewerValidationRule) => void;
  removeRule: (clauseId: string, ruleId: string) => void;
  addSeverity: () => void;
  updateSeverity: (severityId: string, next: Partial<ViewerValidationSeverity>) => void;
  /** Rules pointing at `severityId` are moved to `remapToId` so nothing is silently dropped. */
  removeSeverity: (severityId: string, remapToId: string) => void;
  /** Moves a severity one step up or down the rank, renumbering `order`. */
  moveSeverity: (severityId: string, direction: "up" | "down") => void;
  /** Counts the rules currently assigned to each severity id. */
  countRulesBySeverity: () => Record<string, number>;
  /**
   * Replaces clauses wholesale (import, starter template) while keeping the user's own severity
   * definitions — an incoming config only contributes severity ids they do not already have.
   */
  replaceConfig: (config: ViewerValidationConfig) => void;
  /**
   * Appends the clauses of a clause template instead of replacing the clause set. The
   * incoming clauses are re-identified, so the same template can be inserted more than
   * once, and any severity they reference that the user does not have is merged in.
   */
  insertClauses: (config: ViewerValidationConfig) => void;
};

const ViewerRulesContext = createContext<ViewerRulesContextValue | null>(null);
const RULES_CONFIG_ENDPOINT = "/api/rules/config";

// Postgres (via /api/rules/config) is the source of truth. localStorage is an
// offline cache, read through useSyncExternalStore so it stays SSR-safe and the
// UI paints instantly; the server snapshot hydrates over it on mount.
const rulesStoreListeners = new Set<() => void>();
const emptyConfigSnapshot = createEmptyViewerValidationConfig();
let cachedConfigText: string | null = null;
let cachedConfigSnapshot: ViewerValidationConfig = emptyConfigSnapshot;

function readCacheSnapshot(): ViewerValidationConfig {
  if (typeof window === "undefined") {
    return emptyConfigSnapshot;
  }

  const text = window.localStorage.getItem(VIEWER_VALIDATION_STORAGE_KEY);
  if (!text) {
    cachedConfigText = null;
    cachedConfigSnapshot = emptyConfigSnapshot;
    return cachedConfigSnapshot;
  }

  if (text === cachedConfigText) {
    return cachedConfigSnapshot;
  }

  try {
    cachedConfigText = text;
    cachedConfigSnapshot = parseStoredViewerValidationConfigText(text);
    return cachedConfigSnapshot;
  } catch {
    window.localStorage.removeItem(VIEWER_VALIDATION_STORAGE_KEY);
    cachedConfigText = null;
    cachedConfigSnapshot = emptyConfigSnapshot;
    return cachedConfigSnapshot;
  }
}

function getServerSnapshot() {
  return emptyConfigSnapshot;
}

function notifyRulesStoreListeners() {
  for (const listener of rulesStoreListeners) {
    listener();
  }
}

function subscribeToRulesStore(listener: () => void) {
  rulesStoreListeners.add(listener);
  const handleStorage = (event: StorageEvent) => {
    if (
      event.storageArea === window.localStorage &&
      (event.key === VIEWER_VALIDATION_STORAGE_KEY || event.key === null)
    ) {
      listener();
    }
  };

  window.addEventListener("storage", handleStorage);

  return () => {
    window.removeEventListener("storage", handleStorage);
    rulesStoreListeners.delete(listener);
  };
}

function writeCache(config: ViewerValidationConfig): ViewerValidationConfig {
  const sanitized = sanitizeViewerValidationConfig(config);
  cachedConfigText = JSON.stringify(sanitized);
  cachedConfigSnapshot = sanitized;
  if (typeof window !== "undefined") {
    window.localStorage.setItem(VIEWER_VALIDATION_STORAGE_KEY, cachedConfigText);
  }
  notifyRulesStoreListeners();
  return sanitized;
}

export function ViewerRulesProvider({ children }: PropsWithChildren) {
  const config = useSyncExternalStore(
    subscribeToRulesStore,
    readCacheSnapshot,
    getServerSnapshot,
  );

  // Hydrate the cache from the server on mount.
  useEffect(() => {
    const controller = new AbortController();

    fetch(RULES_CONFIG_ENDPOINT, { signal: controller.signal, cache: "no-store" })
      .then((response) => {
        if (!response.ok) {
          throw new Error(`Rules config request failed (${response.status}).`);
        }
        return response.json() as Promise<ViewerValidationConfig>;
      })
      .then((serverConfig) => {
        writeCache(serverConfig);
      })
      .catch(() => {
        // Offline / server error — keep whatever the cache provided.
      });

    return () => controller.abort();
  }, []);

  // Optimistically update the cache, then write through to the server.
  const persist = useCallback((nextConfig: ViewerValidationConfig) => {
    const sanitized = writeCache(nextConfig);

    void fetch(RULES_CONFIG_ENDPOINT, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(sanitized),
    }).catch(() => {
      // Best-effort write-through; the cache holds the latest edit for retry on reload.
    });
  }, []);

  const value = useMemo<ViewerRulesContextValue>(
    () => ({
      config,
      addClause() {
        persist({
          ...config,
          clauses: [...config.clauses, createViewerValidationClause()],
        });
      },
      updateClause(clauseId, nextClause) {
        persist({
          ...config,
          clauses: config.clauses.map((clause) => (clause.id === clauseId ? nextClause : clause)),
        });
      },
      removeClause(clauseId) {
        persist({
          ...config,
          clauses: config.clauses.filter((clause) => clause.id !== clauseId),
        });
      },
      addRule(clauseId) {
        persist({
          ...config,
          clauses: config.clauses.map((clause) =>
            clause.id === clauseId
              ? {
                  ...clause,
                  rules: [...clause.rules, createViewerValidationRule()],
                }
              : clause,
          ),
        });
      },
      updateRule(clauseId, ruleId, nextRule) {
        persist({
          ...config,
          clauses: config.clauses.map((clause) =>
            clause.id === clauseId
              ? {
                  ...clause,
                  rules: clause.rules.map((rule) => (rule.id === ruleId ? nextRule : rule)),
                }
              : clause,
          ),
        });
      },
      removeRule(clauseId, ruleId) {
        persist({
          ...config,
          clauses: config.clauses.map((clause) =>
            clause.id === clauseId
              ? {
                  ...clause,
                  rules: clause.rules.filter((rule) => rule.id !== ruleId),
                }
              : clause,
          ),
        });
      },
      addSeverity() {
        persist({
          ...config,
          severities: [...config.severities, createViewerValidationSeverity(config.severities)],
        });
      },
      updateSeverity(severityId, next) {
        persist({
          ...config,
          severities: config.severities.map((severity) =>
            severity.id === severityId ? { ...severity, ...next, id: severity.id } : severity,
          ),
        });
      },
      removeSeverity(severityId, remapToId) {
        // The last severity cannot go: rules must always resolve to something.
        if (config.severities.length <= 1) {
          return;
        }

        const severities = config.severities.filter((severity) => severity.id !== severityId);
        const target = severities.some((severity) => severity.id === remapToId)
          ? remapToId
          : severities[severities.length - 1].id;

        persist({
          ...config,
          severities,
          clauses: config.clauses.map((clause) => ({
            ...clause,
            rules: clause.rules.map((rule) =>
              rule.failSeverity === severityId ? { ...rule, failSeverity: target } : rule,
            ),
          })),
        });
      },
      moveSeverity(severityId, direction) {
        const ordered = [...config.severities].sort((left, right) => left.order - right.order);
        const index = ordered.findIndex((severity) => severity.id === severityId);
        const swapWith = direction === "up" ? index + 1 : index - 1;
        if (index === -1 || swapWith < 0 || swapWith >= ordered.length) {
          return;
        }

        [ordered[index], ordered[swapWith]] = [ordered[swapWith], ordered[index]];

        persist({
          ...config,
          severities: ordered.map((severity, position) => ({ ...severity, order: position + 1 })),
        });
      },
      countRulesBySeverity() {
        const counts: Record<string, number> = Object.fromEntries(
          config.severities.map((severity) => [severity.id, 0]),
        );

        for (const clause of config.clauses) {
          for (const rule of clause.rules) {
            counts[rule.failSeverity] = (counts[rule.failSeverity] ?? 0) + 1;
          }
        }

        return counts;
      },
      replaceConfig(nextConfig) {
        persist({
          ...nextConfig,
          severities: mergeViewerValidationSeverities(config.severities, nextConfig.severities),
        });
      },
      insertClauses(nextConfig) {
        persist({
          ...config,
          severities: mergeViewerValidationSeverities(config.severities, nextConfig.severities),
          clauses: [...config.clauses, ...cloneViewerValidationClauses(nextConfig.clauses)],
        });
      },
    }),
    [config, persist],
  );

  return <ViewerRulesContext.Provider value={value}>{children}</ViewerRulesContext.Provider>;
}

/**
 * The configured severities plus a resolved lookup, for anything that only needs to render a
 * severity (colour, label) rather than edit the rules config.
 */
export function useViewerSeverities() {
  const { config } = useViewerRules();

  return useMemo(() => {
    const scale = buildViewerSeverityScale(config.severities);

    return {
      severities: scale.list,
      scale,
      /** Falls back to a neutral stand-in so an unknown id still renders something sane. */
      label: (id: string) => scale.get(id)?.label ?? id,
      color: (id: string) => scale.get(id)?.color ?? null,
    };
  }, [config.severities]);
}

export function useViewerRules() {
  const context = useContext(ViewerRulesContext);
  if (!context) {
    throw new Error("useViewerRules must be used within ViewerRulesProvider.");
  }

  return context;
}
