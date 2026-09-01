import type {
  KnowledgeChatRequest,
  KnowledgeChatStreamEvent,
  KnowledgeStatus,
} from "@/features/viewer/types";

async function errorMessage(response: Response, fallback: string) {
  try {
    const body = (await response.json()) as { error?: unknown };
    return typeof body.error === "string" ? body.error : fallback;
  } catch {
    return fallback;
  }
}

export async function readKnowledgeStatus(signal?: AbortSignal): Promise<KnowledgeStatus> {
  const response = await fetch("/api/knowledge/status", { cache: "no-store", signal });
  if (!response.ok) throw new Error(await errorMessage(response, "Knowledge status could not be read."));
  return (await response.json()) as KnowledgeStatus;
}

export async function streamKnowledgeChat(
  request: KnowledgeChatRequest,
  onEvent: (event: KnowledgeChatStreamEvent) => void,
  signal?: AbortSignal,
) {
  const response = await fetch("/api/knowledge/chat", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(request),
    signal,
  });
  if (!response.ok) throw new Error(await errorMessage(response, "The knowledge assistant could not start."));
  if (!response.body) throw new Error("The knowledge assistant returned no response stream.");

  const reader = response.body.pipeThrough(new TextDecoderStream()).getReader();
  let buffer = "";
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += value;
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";
    for (const line of lines) {
      if (!line.trim()) continue;
      onEvent(JSON.parse(line) as KnowledgeChatStreamEvent);
    }
  }
  if (buffer.trim()) onEvent(JSON.parse(buffer) as KnowledgeChatStreamEvent);
}
