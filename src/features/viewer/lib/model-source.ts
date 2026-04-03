import type { ModelSource, ModelSourceResult } from "@/features/viewer/types";

export class LocalFileModelSource implements ModelSource {
  readonly id = "local-file";
  readonly kind = "local-file" as const;

  async read(file: File): Promise<ModelSourceResult> {
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
