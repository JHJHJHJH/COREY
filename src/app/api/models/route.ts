import { getModelStore } from "@/server/model-store";

export async function GET() {
  const store = getModelStore();
  const models = await store.list();

  return Response.json({ models });
}

export async function POST(request: Request) {
  try {
    const headerName = request.headers.get("x-model-name");
    const name = headerName ? decodeURIComponent(headerName) : "model.ifc";

    const bytes = new Uint8Array(await request.arrayBuffer());
    if (bytes.byteLength === 0) {
      return Response.json({ error: "Empty model upload." }, { status: 400 });
    }

    const store = getModelStore();
    const summary = await store.save({ name, bytes });

    return Response.json(summary, { status: 201 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Model upload failed.";
    return Response.json({ error: message }, { status: 400 });
  }
}
