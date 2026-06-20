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
  createViewerValidationClause,
  createViewerValidationRule,
  createEmptyViewerValidationConfig,
  parseStoredViewerValidationConfigText,
  sanitizeViewerValidationConfig,
} from "@/features/rules/lib/validation";
import type {
  ViewerValidationClause,
  ViewerValidationConfig,
  ViewerValidationRule,
} from "@/features/viewer/types";

type ViewerRulesContextValue = {
  config: ViewerValidationConfig;
  addClause: () => void;
  updateClause: (clauseId: string, nextClause: ViewerValidationClause) => void;
  removeClause: (clauseId: string) => void;
  addRule: (clauseId: string) => void;
  updateRule: (clauseId: string, ruleId: string, nextRule: ViewerValidationRule) => void;
  removeRule: (clauseId: string, ruleId: string) => void;
  replaceConfig: (config: ViewerValidationConfig) => void;
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
      replaceConfig(nextConfig) {
        persist(nextConfig);
      },
    }),
    [config, persist],
  );

  return <ViewerRulesContext.Provider value={value}>{children}</ViewerRulesContext.Provider>;
}

export function useViewerRules() {
  const context = useContext(ViewerRulesContext);
  if (!context) {
    throw new Error("useViewerRules must be used within ViewerRulesProvider.");
  }

  return context;
}
