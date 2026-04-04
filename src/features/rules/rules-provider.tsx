"use client";

import {
  createContext,
  useContext,
  useMemo,
  useSyncExternalStore,
  type PropsWithChildren,
} from "react";
import {
  VIEWER_VALIDATION_STORAGE_KEY,
  createEmptyViewerValidationConfig,
  createViewerValidationRule,
  parseViewerValidationConfigText,
  sanitizeViewerValidationConfig,
} from "@/features/rules/lib/validation";
import type { ViewerValidationConfig, ViewerValidationRule } from "@/features/viewer/types";

type ViewerRulesContextValue = {
  config: ViewerValidationConfig;
  addRule: () => void;
  updateRule: (ruleId: string, nextRule: ViewerValidationRule) => void;
  removeRule: (ruleId: string) => void;
  replaceConfig: (config: ViewerValidationConfig) => void;
};

const ViewerRulesContext = createContext<ViewerRulesContextValue | null>(null);
const rulesStoreListeners = new Set<() => void>();
const emptyConfigSnapshot = createEmptyViewerValidationConfig();
let cachedConfigText: string | null = null;
let cachedConfigSnapshot: ViewerValidationConfig = emptyConfigSnapshot;

function readStoredConfig() {
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
    cachedConfigSnapshot = parseViewerValidationConfigText(text);
    return cachedConfigSnapshot;
  } catch {
    window.localStorage.removeItem(VIEWER_VALIDATION_STORAGE_KEY);
    cachedConfigText = null;
    cachedConfigSnapshot = emptyConfigSnapshot;
    return cachedConfigSnapshot;
  }
}

function emitRulesStoreChange() {
  for (const listener of rulesStoreListeners) {
    listener();
  }
}

function writeStoredConfig(config: ViewerValidationConfig) {
  if (typeof window === "undefined") {
    return;
  }

  const sanitizedConfig = sanitizeViewerValidationConfig(config);
  const text = JSON.stringify(sanitizedConfig);
  cachedConfigText = text;
  cachedConfigSnapshot = sanitizedConfig;
  window.localStorage.setItem(VIEWER_VALIDATION_STORAGE_KEY, text);
  emitRulesStoreChange();
}

function subscribeToRulesStore(listener: () => void) {
  rulesStoreListeners.add(listener);

  const handleStorage = (event: StorageEvent) => {
    if (event.key === VIEWER_VALIDATION_STORAGE_KEY) {
      listener();
    }
  };

  if (typeof window !== "undefined") {
    window.addEventListener("storage", handleStorage);
  }

  return () => {
    rulesStoreListeners.delete(listener);
    if (typeof window !== "undefined") {
      window.removeEventListener("storage", handleStorage);
    }
  };
}

export function ViewerRulesProvider({ children }: PropsWithChildren) {
  const config = useSyncExternalStore(
    subscribeToRulesStore,
    readStoredConfig,
    () => emptyConfigSnapshot,
  );

  const value = useMemo<ViewerRulesContextValue>(
    () => ({
      config,
      addRule() {
        writeStoredConfig({
          ...config,
          rules: [...config.rules, createViewerValidationRule()],
        });
      },
      updateRule(ruleId, nextRule) {
        writeStoredConfig({
          ...config,
          rules: config.rules.map((rule) => (rule.id === ruleId ? nextRule : rule)),
        });
      },
      removeRule(ruleId) {
        writeStoredConfig({
          ...config,
          rules: config.rules.filter((rule) => rule.id !== ruleId),
        });
      },
      replaceConfig(nextConfig) {
        writeStoredConfig(nextConfig);
      },
    }),
    [config],
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
