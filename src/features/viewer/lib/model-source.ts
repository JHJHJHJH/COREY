import type { ModelSource, ModelSourceInput, ModelSourceResult } from "@/features/viewer/types";

export class LocalFileModelSource implements ModelSource {
  readonly id = "local-file";
  readonly kind = "local-file" as const;

  async read(input: ModelSourceInput): Promise<ModelSourceResult> {
    if (input.kind !== "file") {
      throw new Error("LocalFileModelSource can only read local files.");
    }

    const { file } = input;
    const bytes = new Uint8Array(await file.arrayBuffer());

    return {
      bytes,
      metadata: {
        name: file.name,
        size: file.size,
        loadStatus: "loading",
        sourceId: `${file.name}:${file.size}:${file.lastModified}`,
      },
    };
  }
}

export class RemoteModelSource implements ModelSource {
  readonly id = "remote";
  readonly kind = "remote" as const;

  async read(input: ModelSourceInput): Promise<ModelSourceResult> {
    if (input.kind !== "remote") {
      throw new Error("RemoteModelSource can only read remote models.");
    }

    const { modelId } = input;

    const metadataResponse = await fetch(`/api/models/${modelId}`);
    if (!metadataResponse.ok) {
      throw new Error(`Server model ${modelId} could not be found.`);
    }
    const summary = (await metadataResponse.json()) as { name: string; size: number };

    const fileResponse = await fetch(`/api/models/${modelId}/file`);
    if (!fileResponse.ok) {
      throw new Error(`Server model ${modelId} could not be downloaded.`);
    }
    const bytes = new Uint8Array(await fileResponse.arrayBuffer());

    return {
      bytes,
      metadata: {
        name: summary.name,
        // The stored byte length is the source of truth for remote models.
        size: bytes.byteLength,
        loadStatus: "loading",
        // The server model id is the stable identity downstream features key off.
        sourceId: modelId,
        serverModelId: modelId,
      },
    };
  }
}
