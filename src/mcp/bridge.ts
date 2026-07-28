import { randomUUID } from "node:crypto";
import type { IncomingMessage, Server as HttpServer } from "node:http";
import { WebSocket, WebSocketServer } from "ws";
import type { RawData } from "ws";
import type {
  CoreyMcpBridgeCommand,
  CoreyMcpBrowserMessage,
  CoreyMcpServerMessage,
  CoreyMcpSessionDescriptor,
} from "@/features/viewer/mcp/contracts";
import { verifyCoreyMcpBridgeToken } from "@/server/mcp-token";

type Session = {
  userId: string;
  socket: WebSocket;
  descriptor: CoreyMcpSessionDescriptor;
};

type Pending = {
  sessionId: string;
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
  timer: NodeJS.Timeout;
};

const MAX_BRIDGE_PAYLOAD = 2 * 1024 * 1024;
const COMMAND_TIMEOUT_MS = 30_000;

export class BrowserBridgeRegistry {
  private readonly server = new WebSocketServer({
    noServer: true,
    maxPayload: MAX_BRIDGE_PAYLOAD,
  });
  private readonly sessions = new Map<string, Session>();
  private readonly pending = new Map<string, Pending>();
  private readonly claimsBySocket = new WeakMap<
    WebSocket,
    { userId: string; sessionId: string }
  >();
  private heartbeat: NodeJS.Timeout | null = null;

  constructor(
    private readonly secret: string,
    private readonly allowedOrigins: Set<string>,
  ) {
    this.server.on("connection", (socket: WebSocket, request: IncomingMessage) => {
      const claims = this.claimsBySocket.get(socket);
      if (!claims) {
        socket.close(1008, "Missing authentication");
        return;
      }
      let authenticated = false;

      socket.on("message", (data: RawData) => {
        let message: CoreyMcpBrowserMessage;
        try {
          message = JSON.parse(data.toString()) as CoreyMcpBrowserMessage;
        } catch {
          socket.close(1003, "Invalid JSON");
          return;
        }

        if (!authenticated) {
          if (message.type !== "hello" || message.descriptor.sessionId !== claims.sessionId) {
            socket.close(1008, "Invalid session");
            return;
          }
          authenticated = true;
          const previous = this.sessions.get(claims.sessionId);
          previous?.socket.close(1000, "Session reconnected");
          this.sessions.set(claims.sessionId, {
            userId: claims.userId,
            socket,
            descriptor: message.descriptor,
          });
          return;
        }

        if (message.type === "state") {
          const session = this.sessions.get(claims.sessionId);
          if (
            session &&
            session.socket === socket &&
            message.descriptor.sessionId === claims.sessionId
          ) {
            session.descriptor = message.descriptor;
          }
          return;
        }

        if (message.type === "result") {
          const pending = this.pending.get(message.requestId);
          if (!pending || pending.sessionId !== claims.sessionId) return;
          clearTimeout(pending.timer);
          this.pending.delete(message.requestId);
          if (message.ok) pending.resolve(message.value);
          else pending.reject(new Error(message.error));
        }
      });

      socket.on("pong", () => {
        (socket as WebSocket & { isAlive?: boolean }).isAlive = true;
      });
      socket.on("close", () => {
        const current = this.sessions.get(claims.sessionId);
        if (current?.socket === socket) this.sessions.delete(claims.sessionId);
        for (const [requestId, pending] of this.pending) {
          if (pending.sessionId !== claims.sessionId) continue;
          clearTimeout(pending.timer);
          pending.reject(new Error("The COREY browser session disconnected."));
          this.pending.delete(requestId);
        }
      });
      request.socket.setNoDelay(true);
    });
  }

  attach(server: HttpServer) {
    server.on("upgrade", (request, socket, head) => {
      const url = new URL(request.url ?? "/", "http://localhost");
      if (url.pathname !== "/bridge") {
        socket.destroy();
        return;
      }
      const origin = request.headers.origin ?? "";
      if (this.allowedOrigins.size > 0 && !this.allowedOrigins.has(origin)) {
        socket.write("HTTP/1.1 403 Forbidden\r\n\r\n");
        socket.destroy();
        return;
      }
      const claims = verifyCoreyMcpBridgeToken(
        url.searchParams.get("token") ?? "",
        this.secret,
      );
      if (!claims) {
        socket.write("HTTP/1.1 401 Unauthorized\r\n\r\n");
        socket.destroy();
        return;
      }
      this.server.handleUpgrade(request, socket, head, (webSocket) => {
        this.claimsBySocket.set(webSocket, {
          userId: claims.userId,
          sessionId: claims.sessionId,
        });
        this.server.emit("connection", webSocket, request);
      });
    });
    this.heartbeat = setInterval(() => {
      for (const session of this.sessions.values()) {
        const socket = session.socket as WebSocket & { isAlive?: boolean };
        if (socket.isAlive === false) {
          socket.terminate();
          continue;
        }
        socket.isAlive = false;
        socket.ping();
      }
    }, 30_000);
    this.heartbeat.unref();
  }

  list(userId: string) {
    return [...this.sessions.values()]
      .filter((session) => session.userId === userId)
      .map((session) => session.descriptor);
  }

  private get(userId: string, sessionId: string) {
    const session = this.sessions.get(sessionId);
    return session?.userId === userId ? session : null;
  }

  async command(
    userId: string,
    sessionId: string,
    command: CoreyMcpBridgeCommand,
    timeoutMs = COMMAND_TIMEOUT_MS,
  ) {
    const session = this.get(userId, sessionId);
    if (!session || session.socket.readyState !== WebSocket.OPEN) {
      throw new Error("The requested COREY browser session is not connected.");
    }
    const requestId = randomUUID();
    const message: CoreyMcpServerMessage = { type: "command", requestId, command };
    return new Promise<unknown>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(requestId);
        reject(new Error("The COREY browser command timed out."));
      }, timeoutMs);
      this.pending.set(requestId, { sessionId, resolve, reject, timer });
      session.socket.send(JSON.stringify(message), (error) => {
        if (!error) return;
        clearTimeout(timer);
        this.pending.delete(requestId);
        reject(error);
      });
    });
  }

  async refreshStoredDraft(userId: string, modelId: string) {
    const matching = this.list(userId).filter(
      (descriptor) => descriptor.model?.serverModelId === modelId,
    );
    await Promise.allSettled(
      matching.map((descriptor) =>
        this.command(userId, descriptor.sessionId, {
          method: "refresh_draft",
          params: { modelId },
        }),
      ),
    );
  }

  close() {
    if (this.heartbeat) clearInterval(this.heartbeat);
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timer);
      pending.reject(new Error("The COREY MCP bridge is shutting down."));
    }
    this.pending.clear();
    for (const session of this.sessions.values()) session.socket.close(1001, "Server shutdown");
    this.sessions.clear();
    this.server.close();
  }
}
