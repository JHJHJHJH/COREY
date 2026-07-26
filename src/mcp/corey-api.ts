import {
  parseStoredViewerDataTableDraft,
  serializeViewerDataTableDraft,
} from "@/features/viewer/lib/data-table-draft";
import { parseViewerValidationConfig } from "@/features/rules/lib/validation";
import type {
  ServerModelSummary,
  ViewerDataTableDraft,
  ViewerValidationConfig,
} from "@/features/viewer/types";

type ApiClientOptions = {
  baseUrl: string;
  userHeader: string;
};

async function readError(response: Response) {
  const body = (await response.json().catch(() => null)) as { error?: unknown } | null;
  return typeof body?.error === "string"
    ? body.error
    : `COREY API request failed (${response.status}).`;
}

export class CoreyApiClient {
  readonly baseUrl: string;
  readonly userHeader: string;

  constructor(options: ApiClientOptions) {
    this.baseUrl = options.baseUrl.replace(/\/+$/, "");
    this.userHeader = options.userHeader;
  }

  private async request(userId: string, path: string, init: RequestInit = {}) {
    const headers = new Headers(init.headers);
    headers.set(this.userHeader, userId);
    const response = await fetch(`${this.baseUrl}${path}`, {
      ...init,
      headers,
      cache: "no-store",
    });
    if (!response.ok) throw new Error(await readError(response));
    return response;
  }

  async listModels(userId: string): Promise<ServerModelSummary[]> {
    const response = await this.request(userId, "/api/models");
    const body = (await response.json()) as { models: ServerModelSummary[] };
    return body.models;
  }

  async getModel(userId: string, modelId: string): Promise<ServerModelSummary> {
    const response = await this.request(
      userId,
      `/api/models/${encodeURIComponent(modelId)}`,
    );
    return (await response.json()) as ServerModelSummary;
  }

  async getModelBytes(userId: string, modelId: string) {
    const response = await this.request(
      userId,
      `/api/models/${encodeURIComponent(modelId)}/file`,
    );
    return new Uint8Array(await response.arrayBuffer());
  }

  async getDraft(userId: string, modelId: string): Promise<ViewerDataTableDraft | null> {
    const response = await this.request(
      userId,
      `/api/models/${encodeURIComponent(modelId)}/draft`,
    );
    const body = (await response.json()) as { draft: unknown };
    return body.draft ? parseStoredViewerDataTableDraft(modelId, body.draft) : null;
  }

  async putDraft(
    userId: string,
    modelId: string,
    draft: ViewerDataTableDraft | null,
  ): Promise<ViewerDataTableDraft | null> {
    if (!draft) {
      await this.request(userId, `/api/models/${encodeURIComponent(modelId)}/draft`, {
        method: "DELETE",
      });
      return null;
    }
    const response = await this.request(
      userId,
      `/api/models/${encodeURIComponent(modelId)}/draft`,
      {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(serializeViewerDataTableDraft(draft)),
      },
    );
    const body = (await response.json()) as { draft: unknown };
    return body.draft ? parseStoredViewerDataTableDraft(modelId, body.draft) : null;
  }

  async getRules(userId: string): Promise<ViewerValidationConfig> {
    const response = await this.request(userId, "/api/rules/config");
    return parseViewerValidationConfig(await response.json());
  }
}

