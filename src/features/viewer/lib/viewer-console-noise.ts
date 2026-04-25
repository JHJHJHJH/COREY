const KNOWN_VIEWER_CONSOLE_NOISE_PATTERNS = [
  /^Fragments: Zero length geometry: \d+$/,
  /Clock: This module has been deprecated\. Please use THREE\.Timer instead\.$/,
] as const;

let activeFilterCount = 0;
let restoreConsoleFilter: (() => void) | null = null;

function stringifyConsoleArg(value: unknown) {
  if (typeof value === "string") {
    return value;
  }

  if (value instanceof Error) {
    return value.message;
  }

  try {
    return String(value);
  } catch {
    return "";
  }
}

export function shouldSuppressViewerConsoleMessage(args: ReadonlyArray<unknown>) {
  const message = args.map(stringifyConsoleArg).join(" ").trim();
  if (message.length === 0) {
    return false;
  }

  return KNOWN_VIEWER_CONSOLE_NOISE_PATTERNS.some((pattern) => pattern.test(message));
}

function createFilteredConsoleMethod<TArgs extends unknown[]>(
  originalMethod: (...args: TArgs) => void,
) {
  return (...args: TArgs) => {
    if (shouldSuppressViewerConsoleMessage(args)) {
      return;
    }

    originalMethod(...args);
  };
}

export function installViewerConsoleNoiseFilter() {
  activeFilterCount += 1;
  if (restoreConsoleFilter) {
    return () => {
      activeFilterCount = Math.max(0, activeFilterCount - 1);
      if (activeFilterCount === 0) {
        restoreConsoleFilter?.();
        restoreConsoleFilter = null;
      }
    };
  }

  const originalLog = console.log;
  const originalWarn = console.warn;

  console.log = createFilteredConsoleMethod(originalLog);
  console.warn = createFilteredConsoleMethod(originalWarn);

  restoreConsoleFilter = () => {
    console.log = originalLog;
    console.warn = originalWarn;
  };

  return () => {
    activeFilterCount = Math.max(0, activeFilterCount - 1);
    if (activeFilterCount === 0) {
      restoreConsoleFilter?.();
      restoreConsoleFilter = null;
    }
  };
}
