import { createReadStream } from "node:fs";
import { Readable } from "node:stream";
import { prisma } from "@/server/db";
import {
  knowledgeEtagMatches,
  requestedKnowledgeByteRange,
  verifiedKnowledgeSourceFile,
} from "@/server/knowledge-source-files";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function serve(request: Request, id: string, headOnly: boolean) {
  const document = await prisma.knowledgeDocument.findFirst({
    where: { id, sourceKind: "cop_pdf", revision: { status: "active" } },
    select: { fileName: true, sha256: true },
  });
  if (!document) return Response.json({ error: "PDF source not found." }, { status: 404 });

  const file = await verifiedKnowledgeSourceFile(document.fileName, document.sha256);
  const etag = `"sha256-${document.sha256}"`;
  const rangeHeader = request.headers.get("range");
  if (!rangeHeader && knowledgeEtagMatches(request.headers.get("if-none-match"), etag)) {
    return new Response(null, { status: 304, headers: { ETag: etag } });
  }
  const requestedRange = requestedKnowledgeByteRange(
    rangeHeader,
    request.headers.get("if-range"),
    etag,
    file.size,
  );
  if (requestedRange === "invalid") {
    return new Response(null, {
      status: 416,
      headers: { "Accept-Ranges": "bytes", "Content-Range": `bytes */${file.size}` },
    });
  }
  const range = requestedRange ?? { start: 0, end: file.size - 1 };
  const length = range.end - range.start + 1;
  const headers = new Headers({
    "Accept-Ranges": "bytes",
    "Cache-Control": "public, max-age=31536000, immutable",
    "Content-Disposition": `inline; filename="${document.fileName.replaceAll('"', "")}"`,
    "Content-Length": String(length),
    "Content-Type": "application/pdf",
    "Cross-Origin-Resource-Policy": "same-origin",
    ETag: etag,
  });
  if (requestedRange) {
    headers.set("Content-Range", `bytes ${range.start}-${range.end}/${file.size}`);
  }
  if (headOnly) {
    return new Response(null, { status: requestedRange ? 206 : 200, headers });
  }
  const nodeStream = createReadStream(file.path, { start: range.start, end: range.end });
  return new Response(Readable.toWeb(nodeStream) as ReadableStream, {
    status: requestedRange ? 206 : 200,
    headers,
  });
}

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    return await serve(request, (await context.params).id, false);
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "The PDF source could not be opened." },
      { status: 503 },
    );
  }
}

export async function HEAD(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    return await serve(request, (await context.params).id, true);
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "The PDF source could not be opened." },
      { status: 503 },
    );
  }
}
