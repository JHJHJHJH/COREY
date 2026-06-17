import { getModelStore } from "@/server/model-store";
import { getMaxModelBytes } from "@/server/env";

function formatBytes(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export async function GET() {
  const store = getModelStore();
  const models = await store.list();

  return Response.json({ models });
}

export async function POST(request: Request) {
  try {
    const headerName = request.headers.get("x-model-name");
    const name = headerName ? decodeURIComponent(headerName) : "model.ifc";
    const maxModelBytes = getMaxModelBytes();
    const contentLength = Number(request.headers.get("content-length") ?? Number.NaN);

    if (Number.isFinite(contentLength) && contentLength > maxModelBytes) {
      return Response.json(
        {
          error: `Model upload is too large. Maximum size is ${formatBytes(maxModelBytes)}.`,
        },
        { status: 413 },
      );
    }

    const bytes = new Uint8Array(await request.arrayBuffer());
    if (bytes.byteLength === 0) {
      return Response.json({ error: "Empty model upload." }, { status: 400 });
    }

    if (bytes.byteLength > maxModelBytes) {
      return Response.json(
        {
          error: `Model upload is too large. Maximum size is ${formatBytes(maxModelBytes)}.`,
        },
        { status: 413 },
      );
    }

    const store = getModelStore();
    const summary = await store.save({ name, bytes });

    return Response.json(summary, { status: 201 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Model upload failed.";
    return Response.json({ error: message }, { status: 400 });
  }
}
