import { z } from "zod";
import { getKnowledgeEnv } from "@/server/env";
import { getUserIdOrResponse } from "@/server/identity";
import {
  buildKnowledgePrompt,
  getKnowledgeOpenAI,
  knowledgeSafetyIdentifier,
  KNOWLEDGE_INSTRUCTIONS,
  retrieveKnowledge,
} from "@/server/knowledge-store";
import type { KnowledgeChatStreamEvent } from "@/features/viewer/types";

export const runtime = "nodejs";

const propertySchema = z.object({
  group: z.string().max(200).nullable(),
  name: z.string().min(1).max(300),
  value: z.string().max(1000),
});

const contextSchema = z.object({
  modelId: z.string().max(300).nullable(),
  expressId: z.number().int().nonnegative().nullable(),
  label: z.string().max(500).nullable(),
  ifcType: z.string().max(200).nullable(),
  subtype: z.string().max(300).nullable(),
  properties: z.array(propertySchema).max(50),
});

const requestSchema = z.object({
  question: z.string().trim().min(1).max(4000),
  history: z
    .array(z.object({ role: z.enum(["user", "assistant"]), content: z.string().trim().min(1).max(8000) }))
    .max(10)
    .default([]),
  context: contextSchema.optional(),
});

const encoder = new TextEncoder();

function eventLine(event: KnowledgeChatStreamEvent) {
  return encoder.encode(`${JSON.stringify(event)}\n`);
}

export async function POST(request: Request) {
  const userId = getUserIdOrResponse(request);
  if (userId instanceof Response) return userId;

  let input: z.infer<typeof requestSchema>;
  try {
    input = requestSchema.parse(await request.json());
  } catch (error) {
    const message = error instanceof Error ? error.message : "The knowledge request is invalid.";
    return Response.json({ error: message }, { status: 400 });
  }

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      controller.enqueue(eventLine({ type: "status", phase: "retrieving" }));
      try {
        const env = getKnowledgeEnv();
        const retrieval = await retrieveKnowledge(input.question, input.context);
        controller.enqueue(eventLine({ type: "sources", citations: retrieval.citations }));
        controller.enqueue(eventLine({ type: "status", phase: "generating" }));
        const response = await getKnowledgeOpenAI().responses.create(
          {
            model: env.chatModel,
            instructions: KNOWLEDGE_INSTRUCTIONS,
            input: buildKnowledgePrompt({
              question: input.question,
              history: input.history,
              context: input.context,
              evidence: retrieval.evidence,
              graph: retrieval.graph,
            }),
            max_output_tokens: 1200,
            safety_identifier: knowledgeSafetyIdentifier(userId),
            store: false,
            stream: true,
          },
          { signal: request.signal },
        );
        for await (const event of response) {
          if (event.type === "response.output_text.delta") {
            controller.enqueue(eventLine({ type: "delta", text: event.delta }));
          }
        }
        controller.enqueue(eventLine({ type: "done" }));
      } catch (error) {
        if (!request.signal.aborted) {
          controller.enqueue(
            eventLine({
              type: "error",
              message: error instanceof Error ? error.message : "The OpenAI response failed.",
            }),
          );
        }
      } finally {
        controller.close();
      }
    },
  });
  return new Response(stream, {
    headers: {
      "Content-Type": "application/x-ndjson; charset=utf-8",
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
