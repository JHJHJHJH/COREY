/// <reference lib="webworker" />

import { evaluateViewerValidationPayload } from "@/features/rules/lib/validation";
import type {
  ViewerValidationRunPayload,
  ViewerValidationRunResult,
} from "@/features/viewer/types";

type ViewerValidationWorkerRequest = {
  type: "run";
  runId: string;
  payload: ViewerValidationRunPayload;
};

type ViewerValidationWorkerProgressMessage = {
  type: "progress";
  runId: string;
  processedRowCount: number;
  totalRowCount: number;
};

type ViewerValidationWorkerResultMessage = {
  type: "result";
  runId: string;
  result: ViewerValidationRunResult;
};

type ViewerValidationWorkerErrorMessage = {
  type: "error";
  runId: string;
  message: string;
};

type ViewerValidationWorkerMessage =
  | ViewerValidationWorkerProgressMessage
  | ViewerValidationWorkerResultMessage
  | ViewerValidationWorkerErrorMessage;

const workerScope = self as DedicatedWorkerGlobalScope;

workerScope.onmessage = (event: MessageEvent<ViewerValidationWorkerRequest>) => {
  if (event.data.type !== "run") {
    return;
  }

  const { payload, runId } = event.data;

  void (async () => {
    try {
      const result = await evaluateViewerValidationPayload(payload, {
        onProgress: ({ processedRowCount, totalRowCount }) => {
          workerScope.postMessage({
            type: "progress",
            runId,
            processedRowCount,
            totalRowCount,
          } satisfies ViewerValidationWorkerProgressMessage);
        },
      });

      workerScope.postMessage({
        type: "result",
        runId,
        result,
      } satisfies ViewerValidationWorkerResultMessage);
    } catch (error) {
      workerScope.postMessage({
        type: "error",
        runId,
        message: error instanceof Error ? error.message : "Validation worker failed.",
      } satisfies ViewerValidationWorkerErrorMessage);
    }
  })();
};

export type {
  ViewerValidationWorkerMessage,
  ViewerValidationWorkerProgressMessage,
  ViewerValidationWorkerRequest,
  ViewerValidationWorkerResultMessage,
};
