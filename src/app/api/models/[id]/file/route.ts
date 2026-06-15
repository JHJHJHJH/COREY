import { getModelStore } from "@/server/model-store";

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const store = getModelStore();
  const bytes = await store.getBytes(id);

  if (!bytes) {
    return Response.json({ error: "Model not found." }, { status: 404 });
  }

  return new Response(bytes as BodyInit, {
    headers: {
      "Content-Type": "application/octet-stream",
      "Content-Length": String(bytes.byteLength),
    },
  });
}
