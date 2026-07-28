"use client";

import { useEffect, useRef, useState } from "react";
import type {
  CoreyMcpBridgeCommand,
  CoreyMcpServerMessage,
  CoreyMcpSessionDescriptor,
} from "@/features/viewer/mcp/contracts";

export type CoreyMcpConnectionState =
  | "unconfigured"
  | "disconnected"
  | "connecting"
  | "connected"
  | "error";

type CommandParams<Method extends CoreyMcpBridgeCommand["method"]> =
  Extract<CoreyMcpBridgeCommand, { method: Method }>["params"];

export type CoreyMcpCommandHandlers = {
  [Method in CoreyMcpBridgeCommand["method"]]: (
    params: CommandParams<Method>,
  ) => Promise<unknown> | unknown;
};

const SESSION_STORAGE_KEY = "corey.mcp.viewer-session-id";

function getSessionId() {
  const existing = window.sessionStorage.getItem(SESSION_STORAGE_KEY);
  if (existing) return existing;
  const created = window.crypto.randomUUID();
  window.sessionStorage.setItem(SESSION_STORAGE_KEY, created);
  return created;
}

async function getBridgeConfiguration() {
  const response = await fetch("/api/mcp/config", { cache: "no-store" });
  if (!response.ok) throw new Error("MCP bridge configuration could not be loaded.");
  return (await response.json()) as {
    configured: boolean;
    bridgeUrl: string | null;
  };
}

async function getSessionToken(sessionId: string) {
  const response = await fetch("/api/mcp/session-token", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ sessionId }),
  });
  if (!response.ok) throw new Error("MCP bridge session could not be authenticated.");
  return (await response.json()) as { token: string; expiresAt: number };
}

function withToken(url: string, token: string) {
  const parsed = new URL(url, window.location.href);
  parsed.searchParams.set("token", token);
  return parsed.toString();
}

export function useCoreyMcpBridge(input: {
  enabled: boolean;
  descriptor: Omit<CoreyMcpSessionDescriptor, "sessionId" | "connectedAt">;
  handlers: CoreyMcpCommandHandlers;
}) {
  const [state, setState] = useState<CoreyMcpConnectionState>("disconnected");
  const [configured, setConfigured] = useState<boolean | null>(null);
  const socketRef = useRef<WebSocket | null>(null);
  const sessionIdRef = useRef<string | null>(null);
  const descriptorRef = useRef(input.descriptor);
  const handlersRef = useRef(input.handlers);
  const connectedAtRef = useRef(new Date().toISOString());

  useEffect(() => {
    descriptorRef.current = input.descriptor;
    handlersRef.current = input.handlers;
  }, [input.descriptor, input.handlers]);

  useEffect(() => {
    const id = getSessionId();
    sessionIdRef.current = id;
    let stopped = false;
    let reconnectTimer: number | null = null;
    let retryCount = 0;

    const descriptor = (): CoreyMcpSessionDescriptor => ({
      ...descriptorRef.current,
      sessionId: id,
      connectedAt: connectedAtRef.current,
    });

    const connect = async () => {
      try {
        const config = await getBridgeConfiguration();
        if (stopped) return;
        setConfigured(config.configured);
        if (!config.configured || !config.bridgeUrl) {
          setState("unconfigured");
          return;
        }
        if (!input.enabled) {
          setState("disconnected");
          return;
        }
        setState("connecting");
        const { token } = await getSessionToken(id);
        if (stopped) return;
        const socket = new WebSocket(withToken(config.bridgeUrl, token));
        socketRef.current = socket;

        socket.addEventListener("open", () => {
          retryCount = 0;
          connectedAtRef.current = new Date().toISOString();
          setState("connected");
          socket.send(JSON.stringify({ type: "hello", descriptor: descriptor() }));
        });
        socket.addEventListener("message", (event) => {
          void (async () => {
            let message: CoreyMcpServerMessage;
            try {
              message = JSON.parse(String(event.data)) as CoreyMcpServerMessage;
            } catch {
              return;
            }
            if (message.type !== "command") return;
            const handler = handlersRef.current[message.command.method] as (
              params: Record<string, unknown>,
            ) => Promise<unknown> | unknown;
            try {
              const value = await handler(message.command.params);
              if (socket.readyState === WebSocket.OPEN) {
                socket.send(
                  JSON.stringify({
                    type: "result",
                    requestId: message.requestId,
                    ok: true,
                    value,
                  }),
                );
              }
            } catch (error) {
              if (socket.readyState === WebSocket.OPEN) {
                socket.send(
                  JSON.stringify({
                    type: "result",
                    requestId: message.requestId,
                    ok: false,
                    error: error instanceof Error ? error.message : "COREY command failed.",
                  }),
                );
              }
            }
          })();
        });
        socket.addEventListener("close", () => {
          if (socketRef.current === socket) socketRef.current = null;
          if (stopped) return;
          setState("connecting");
          const delay = Math.min(30_000, 1_000 * 2 ** Math.min(retryCount, 5));
          retryCount += 1;
          reconnectTimer = window.setTimeout(() => void connect(), delay);
        });
        socket.addEventListener("error", () => {
          setState("error");
        });
      } catch {
        if (stopped) return;
        setState("error");
        if (!input.enabled) return;
        const delay = Math.min(30_000, 1_000 * 2 ** Math.min(retryCount, 5));
        retryCount += 1;
        reconnectTimer = window.setTimeout(() => void connect(), delay);
      }
    };

    void connect();
    return () => {
      stopped = true;
      if (reconnectTimer !== null) window.clearTimeout(reconnectTimer);
      socketRef.current?.close(1000, input.enabled ? "Viewer closed" : "MCP disconnected");
      socketRef.current = null;
    };
  }, [input.enabled]);

  useEffect(() => {
    const socket = socketRef.current;
    const sessionId = sessionIdRef.current;
    if (!sessionId || state !== "connected" || socket?.readyState !== WebSocket.OPEN) return;
    socket.send(
      JSON.stringify({
        type: "state",
        descriptor: {
          ...input.descriptor,
          sessionId,
          connectedAt: connectedAtRef.current,
        },
      }),
    );
  }, [input.descriptor, state]);

  return { state, configured };
}
