"use client";

import Image from "next/image";
import {
  LoaderCircle,
  PanelRightOpen,
  Send,
  Square,
  Trash2,
  X,
} from "lucide-react";
import {
  FormEvent,
  PointerEvent as ReactPointerEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";
import ReactMarkdown from "react-markdown";
import { Group, Panel, Separator } from "react-resizable-panels";
import remarkGfm from "remark-gfm";
import { CoreyGlyph } from "@/features/viewer/components/corey-glyph";
import { KnowledgeEvidencePanel } from "@/features/viewer/components/knowledge-evidence-panel";
import {
  clampCoreyOverlayPoint,
  exceededCoreyDragThreshold,
  parseStoredCoreyOverlayPoint,
} from "@/features/viewer/lib/corey-overlay-position";
import type { CoreyOverlayPoint } from "@/features/viewer/lib/corey-overlay-position";
import { formatKnowledgeLocator } from "@/features/viewer/lib/pdf-evidence";
import { readKnowledgeStatus, streamKnowledgeChat } from "@/features/viewer/lib/knowledge-api";
import type {
  KnowledgeCitation,
  KnowledgeChatTurn,
  KnowledgeStatus,
  ViewerKnowledgeContext,
} from "@/features/viewer/types";

type KnowledgeMessage = KnowledgeChatTurn & {
  id: string;
  citations: KnowledgeCitation[];
  pending?: boolean;
  phase?: "retrieving" | "generating";
};

const BUBBLE_POSITION_KEY = "corey.overlay.bubble.v1";
const PANEL_POSITION_KEY = "corey.overlay.panel.v1";
const OVERLAY_MARGIN = 16;

type OverlayDragState = {
  startClientX: number;
  startClientY: number;
  startPoint: CoreyOverlayPoint;
  moved: boolean;
  activate?: () => void;
};

function viewportSize() {
  return {
    width: document.documentElement.clientWidth,
    height: document.documentElement.clientHeight,
  };
}

function documentZoom() {
  return Number.parseFloat(window.getComputedStyle(document.documentElement).zoom || "1") || 1;
}

function surfaceSize(element: HTMLElement) {
  return { width: element.offsetWidth, height: element.offsetHeight };
}

function persistPosition(storageKey: string, point: CoreyOverlayPoint) {
  try {
    window.localStorage.setItem(storageKey, JSON.stringify(point));
  } catch {
    // Browser privacy settings may disable local storage; dragging still works for this session.
  }
}

function useDraggableOverlayPosition({
  active,
  storageKey,
  surfaceRef,
  defaultPoint,
}: {
  active: boolean;
  storageKey: string;
  surfaceRef: React.RefObject<HTMLElement | null>;
  defaultPoint: (viewport: { width: number; height: number }, surface: { width: number; height: number }) => CoreyOverlayPoint;
}) {
  const [point, setPoint] = useState<CoreyOverlayPoint>({ x: OVERLAY_MARGIN, y: OVERLAY_MARGIN });
  const pointRef = useRef(point);
  const initializedRef = useRef(false);
  const dragRef = useRef<OverlayDragState | null>(null);
  const [dragging, setDragging] = useState(false);

  const commit = useCallback(
    (candidate: CoreyOverlayPoint, persist = true) => {
      const element = surfaceRef.current;
      if (!element) return candidate;
      const next = clampCoreyOverlayPoint(candidate, viewportSize(), surfaceSize(element));
      pointRef.current = next;
      setPoint(next);
      if (persist) persistPosition(storageKey, next);
      return next;
    },
    [storageKey, surfaceRef],
  );

  useEffect(() => {
    if (!active || !surfaceRef.current) return;
    const element = surfaceRef.current;
    if (!initializedRef.current) {
      let stored: CoreyOverlayPoint | null = null;
      try {
        stored = parseStoredCoreyOverlayPoint(window.localStorage.getItem(storageKey));
      } catch {
        // Use the default when local storage is unavailable.
      }
      initializedRef.current = true;
      commit(stored ?? defaultPoint(viewportSize(), surfaceSize(element)));
    } else {
      commit(pointRef.current);
    }

    const observer = new ResizeObserver(() => commit(pointRef.current));
    observer.observe(element);
    const handleResize = () => commit(pointRef.current);
    window.addEventListener("resize", handleResize);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", handleResize);
    };
  }, [active, commit, defaultPoint, storageKey, surfaceRef]);

  useEffect(() => {
    if (!dragging) return;
    const handlePointerMove = (event: PointerEvent) => {
      const drag = dragRef.current;
      if (!drag) return;
      const deltaX = event.clientX - drag.startClientX;
      const deltaY = event.clientY - drag.startClientY;
      if (!drag.moved && exceededCoreyDragThreshold(deltaX, deltaY)) drag.moved = true;
      const zoom = documentZoom();
      commit(
        { x: drag.startPoint.x + deltaX / zoom, y: drag.startPoint.y + deltaY / zoom },
        false,
      );
    };
    const handlePointerUp = () => {
      const drag = dragRef.current;
      dragRef.current = null;
      setDragging(false);
      persistPosition(storageKey, pointRef.current);
      if (drag && !drag.moved) drag.activate?.();
    };
    document.body.style.cursor = "move";
    document.body.style.userSelect = "none";
    window.addEventListener("pointermove", handlePointerMove);
    window.addEventListener("pointerup", handlePointerUp);
    window.addEventListener("pointercancel", handlePointerUp);
    return () => {
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", handlePointerUp);
      window.removeEventListener("pointercancel", handlePointerUp);
      document.body.style.removeProperty("cursor");
      document.body.style.removeProperty("user-select");
    };
  }, [commit, dragging, storageKey]);

  const beginDrag = useCallback(
    (event: ReactPointerEvent<HTMLElement>, activate?: () => void) => {
      if (event.button !== 0) return;
      event.preventDefault();
      dragRef.current = {
        startClientX: event.clientX,
        startClientY: event.clientY,
        startPoint: pointRef.current,
        moved: false,
        activate,
      };
      setDragging(true);
    },
    [],
  );

  return { point, beginDrag, dragging };
}

const suggestions = [
  "What does BCA review at the Design Gateway?",
  "How should an accessible route be represented in IFC+SG?",
  "Which properties are required for beams?",
  "What are the controlled values for OccupancyType?",
];

function initialStatus(): KnowledgeStatus {
  return {
    available: false,
    configured: false,
    revisionId: null,
    activatedAt: null,
    embeddingModel: null,
    documentCount: 0,
    chunkCount: 0,
    sources: [],
    message: "Checking knowledge corpus…",
  };
}

function dedupeCitations(messages: KnowledgeMessage[]) {
  const found = new Map<string, KnowledgeCitation>();
  for (const message of messages) {
    for (const citation of message.citations) found.set(citation.evidenceId, citation);
  }
  return [...found.values()];
}

function ChatSurface({
  status,
  messages,
  question,
  contextSummary,
  useContext,
  error,
  busy,
  citations,
  inputRef,
  scrollRef,
  onQuestionChange,
  onUseContextChange,
  onAsk,
  onStop,
  onClear,
  onOpenEvidence,
}: {
  status: KnowledgeStatus;
  messages: KnowledgeMessage[];
  question: string;
  contextSummary: string | null;
  useContext: boolean;
  error: string | null;
  busy: boolean;
  citations: KnowledgeCitation[];
  inputRef: React.RefObject<HTMLTextAreaElement | null>;
  scrollRef: React.RefObject<HTMLDivElement | null>;
  onQuestionChange: (value: string) => void;
  onUseContextChange: (value: boolean) => void;
  onAsk: (question: string) => void;
  onStop: () => void;
  onClear: () => void;
  onOpenEvidence: (citation: KnowledgeCitation) => void;
}) {
  return (
    <div className="grid h-full min-h-0 grid-rows-[auto_minmax(0,1fr)_auto_auto] bg-[color:var(--panel-bg)]">
      <div className="flex items-center justify-between gap-3 border-b border-[color:var(--viewer-border)] bg-[color:var(--surface-soft)] px-4 py-2.5">
        <label
          className={`flex min-w-0 items-center gap-2 text-[10px] ${
            contextSummary ? "text-[color:var(--foreground)]" : "text-[color:var(--muted-ink)] opacity-60"
          }`}
        >
          <input
            type="checkbox"
            checked={useContext && Boolean(contextSummary)}
            disabled={!contextSummary}
            onChange={(event) => onUseContextChange(event.target.checked)}
            className="accent-[color:var(--accent)]"
          />
          <span className="truncate">
            {contextSummary ? `Use selected ${contextSummary}` : "Select an IFC element for model context"}
          </span>
        </label>
        <div className="flex shrink-0 items-center gap-1">
          <button
            type="button"
            aria-label="Open evidence"
            title="Open evidence"
            disabled={!citations.length}
            onClick={() => citations[0] && onOpenEvidence(citations[0])}
            className="grid h-8 w-8 place-items-center rounded-[var(--r-control)] text-[color:var(--muted-ink)] transition hover:bg-[color:var(--surface-hover)] hover:text-[color:var(--foreground)] disabled:opacity-30"
          >
            <PanelRightOpen className="h-[18px] w-[18px]" />
          </button>
          <button
            type="button"
            aria-label="Clear conversation"
            title="Clear conversation"
            disabled={!messages.length}
            onClick={onClear}
            className="grid h-8 w-8 place-items-center rounded-[var(--r-control)] text-[color:var(--muted-ink)] transition hover:bg-[color:var(--surface-hover)] hover:text-[color:var(--foreground)] disabled:opacity-30"
          >
            <Trash2 className="h-[18px] w-[18px]" />
          </button>
        </div>
      </div>

      <div
        ref={scrollRef}
        aria-live="polite"
        className="min-h-0 overflow-y-auto px-4 py-4"
      >
        {!messages.length ? (
          <div className="mx-auto flex h-full max-w-xl flex-col items-center justify-center py-5 text-center">
            <div className="grid h-11 w-11 place-items-center bg-transparent">
              <CoreyGlyph size={30} />
            </div>
            <div className="mt-3 text-[9px] font-bold uppercase tracking-[0.18em] text-[color:var(--accent)]">
              COREY
            </div>
            <h2 className="mt-2 text-lg font-semibold text-[color:var(--foreground)]">
              Start a conversation with the COREY
            </h2>
            <p className="mt-2 max-w-md text-xs leading-5 text-[color:var(--muted-ink)]">
              Answers references latest CORENET X COP and IFC+SG Mapping documents.
            </p>
            <div className="mt-5 grid w-full gap-2 sm:grid-cols-2">
              {suggestions.map((suggestion) => (
                <button
                  key={suggestion}
                  type="button"
                  disabled={!status.available}
                  onClick={() => onAsk(suggestion)}
                  className="rounded-[var(--r-control)] border border-[color:var(--viewer-border)] bg-[color:var(--surface-soft)] px-3 py-2.5 text-left text-[11px] leading-4 text-[color:var(--foreground)] transition hover:border-[color:var(--accent)] hover:bg-[color:var(--accent-wash)] disabled:cursor-not-allowed disabled:opacity-45"
                >
                  {suggestion}
                </button>
              ))}
            </div>
            <p className="mt-4 text-[10px] text-[color:var(--muted-ink)]">{status.message}</p>
          </div>
        ) : (
          <div className="mx-auto max-w-3xl space-y-5">
            {messages.map((message) => (
              <article
                key={message.id}
                className={`grid gap-2.5 ${
                  message.role === "user"
                    ? "grid-cols-[minmax(0,1fr)_1.75rem]"
                    : "grid-cols-[1.75rem_minmax(0,1fr)]"
                }`}
              >
                <div
                  className={`grid h-7 w-7 place-items-center rounded-[var(--r-control)] text-[9px] font-bold ${
                    message.role === "user"
                      ? "order-2 bg-[color:var(--surface-strong)] text-[color:var(--foreground)]"
                      : "bg-transparent"
                  }`}
                >
                  {message.role === "user" ? "YOU" : <CoreyGlyph size={24} />}
                </div>
                <div className={message.role === "user" ? "order-1 text-right" : "min-w-0"}>
                  <div className="mb-1.5 text-[10px] font-semibold text-[color:var(--muted-ink)]">
                    {message.role === "user" ? "You" : "Corey"}
                  </div>
                  {message.role === "user" ? (
                    <p className="inline-block rounded-[var(--r-control)] bg-[color:var(--surface-strong)] px-3 py-2 text-left text-xs leading-5">
                      {message.content}
                    </p>
                  ) : message.pending && !message.content ? (
                    <div className="flex items-center gap-2 py-2 text-xs text-[color:var(--muted-ink)]">
                      <LoaderCircle className="h-[22px] w-[22px] animate-spin" />
                      {message.phase === "generating"
                        ? "Writing from evidence…"
                        : "Finding official evidence…"}
                    </div>
                  ) : (
                    <div className="prose prose-sm max-w-none text-xs leading-5 text-[color:var(--foreground)] prose-p:my-2 prose-ul:my-2 prose-ol:my-2 prose-li:my-0.5 dark:prose-invert">
                      <ReactMarkdown
                        remarkPlugins={[remarkGfm]}
                        components={{
                          a: ({ href, children }) => {
                            const match = href?.match(/^#citation-(S\d+)$/);
                            const citation = match
                              ? message.citations.find((item) => item.id === match[1])
                              : undefined;
                            return citation ? (
                              <button
                                type="button"
                                onClick={() => onOpenEvidence(citation)}
                                className="mx-0.5 inline-grid h-5 min-w-6 place-items-center rounded-[var(--r-chip)] bg-[color:var(--accent-wash)] px-1 text-[10px] font-bold text-[color:var(--accent)] no-underline"
                              >
                                {children}
                              </button>
                            ) : (
                              <a href={href} target="_blank" rel="noreferrer">
                                {children}
                              </a>
                            );
                          },
                        }}
                      >
                        {message.content.replace(/\[(S\d+)\]/g, "[$1](#citation-$1)")}
                      </ReactMarkdown>
                      {message.citations.length ? (
                        <div className="mt-3 flex flex-wrap gap-1.5 not-prose">
                          {message.citations.map((citation) => (
                            <button
                              key={citation.evidenceId}
                              type="button"
                              title={`${citation.title} — ${formatKnowledgeLocator(citation.locator)}`}
                              onClick={() => onOpenEvidence(citation)}
                              className="max-w-full truncate rounded-[var(--r-chip)] border border-[color:var(--viewer-border)] bg-[color:var(--surface-soft)] px-2 py-1 text-[9px] text-[color:var(--muted-ink)] transition hover:border-[color:var(--accent)] hover:text-[color:var(--foreground)]"
                            >
                              <span className="mr-1 font-bold text-[color:var(--accent)]">
                                {citation.id}
                              </span>
                              {formatKnowledgeLocator(citation.locator)}
                            </button>
                          ))}
                        </div>
                      ) : null}
                    </div>
                  )}
                </div>
              </article>
            ))}
          </div>
        )}
      </div>

      {error ? (
        <div role="alert" className="mx-4 rounded-[var(--r-control)] border border-[color:var(--danger-border)] bg-[color:var(--danger-bg)] px-3 py-2 text-[10px] text-[color:var(--danger-fg)]">
          {error}
        </div>
      ) : (
        <div />
      )}

      <div className="border-t border-[color:var(--viewer-border)] bg-[color:var(--surface-strong)] px-3 pb-2 pt-3">
        <form
          onSubmit={(event: FormEvent) => {
            event.preventDefault();
            onAsk(question);
          }}
          className="relative rounded-[var(--r-control)] border border-[color:var(--viewer-border)] bg-[color:var(--panel-bg)] p-2 pr-11 shadow-sm focus-within:border-[color:var(--accent)] focus-within:ring-2 focus-within:ring-[color:var(--accent-wash)]"
        >
          <label htmlFor="corey-question" className="sr-only">
            Ask Corey a CORENET X question
          </label>
          <textarea
            ref={inputRef}
            id="corey-question"
            rows={2}
            maxLength={4000}
            value={question}
            disabled={!status.available}
            placeholder="Ask about a gateway, agency, IFC entity, or property…"
            onChange={(event) => onQuestionChange(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && !event.shiftKey) {
                event.preventDefault();
                event.currentTarget.form?.requestSubmit();
              }
            }}
            className="max-h-32 w-full resize-none bg-transparent p-0 text-xs leading-5 text-[color:var(--foreground)] outline-none placeholder:text-[color:var(--muted-ink)] disabled:cursor-not-allowed"
          />
          {busy ? (
            <button
              type="button"
              aria-label="Stop generating"
              onClick={onStop}
              className="absolute bottom-2 right-2 grid h-8 w-8 place-items-center rounded-[var(--r-control)] bg-[color:var(--danger-fg)] text-white"
            >
              <Square className="h-5 w-5" />
            </button>
          ) : (
            <button
              type="submit"
              aria-label="Send question"
              disabled={!question.trim() || !status.available}
              className="absolute bottom-2 right-2 grid h-8 w-8 place-items-center rounded-[var(--r-control)] bg-[color:var(--accent)] text-[color:var(--accent-ink)] transition hover:bg-[color:var(--accent-strong)] disabled:cursor-not-allowed disabled:opacity-35"
            >
              <Send className="h-5 w-5" />
            </button>
          )}
        </form>
        <p className="mt-1.5 text-center text-[9px] text-[color:var(--muted-ink)]">
          COREY is not an official CORENET X tool. Use at your own discretion.
        </p>
      </div>
    </div>
  );
}

export function CoreyAssistant({
  open,
  context,
  onOpen,
  onClose,
}: {
  open: boolean;
  context: ViewerKnowledgeContext | null;
  onOpen: () => void;
  onClose: () => void;
}) {
  const [portalTarget, setPortalTarget] = useState<HTMLElement | null>(null);
  const [mobile, setMobile] = useState(false);
  const [status, setStatus] = useState<KnowledgeStatus>(initialStatus);
  const [messages, setMessages] = useState<KnowledgeMessage[]>([]);
  const [question, setQuestion] = useState("");
  const [useContext, setUseContext] = useState(true);
  const [selectedCitation, setSelectedCitation] = useState<KnowledgeCitation | null>(null);
  const [evidenceOpen, setEvidenceOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const inputRef = useRef<HTMLTextAreaElement | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const bubbleRef = useRef<HTMLButtonElement | null>(null);
  const panelRef = useRef<HTMLElement | null>(null);
  const busy = messages.some((message) => message.pending);
  const citations = useMemo(() => dedupeCitations(messages), [messages]);
  const contextSummary = useMemo(() => {
    if (!context?.ifcType) return null;
    return `${context.ifcType}${context.subtype ? ` · ${context.subtype}` : ""}`;
  }, [context]);
  const defaultBubblePoint = useCallback(
    (viewport: { width: number; height: number }, surface: { width: number; height: number }) => ({
      x: OVERLAY_MARGIN,
      y: viewport.height - surface.height - OVERLAY_MARGIN,
    }),
    [],
  );
  const bubblePosition = useDraggableOverlayPosition({
    active: Boolean(portalTarget) && !open,
    storageKey: BUBBLE_POSITION_KEY,
    surfaceRef: bubbleRef,
    defaultPoint: defaultBubblePoint,
  });
  const defaultPanelPoint = useCallback(
    (_viewport: { width: number; height: number }, surface: { width: number; height: number }) => {
      const aboveBubble = bubblePosition.point.y - surface.height - 12;
      return {
        x: bubblePosition.point.x,
        y:
          aboveBubble >= OVERLAY_MARGIN
            ? aboveBubble
            : bubblePosition.point.y + (bubbleRef.current?.offsetHeight ?? 72) + 12,
      };
    },
    [bubblePosition.point.x, bubblePosition.point.y],
  );
  const panelPosition = useDraggableOverlayPosition({
    active: Boolean(portalTarget) && open && !mobile,
    storageKey: PANEL_POSITION_KEY,
    surfaceRef: panelRef,
    defaultPoint: defaultPanelPoint,
  });

  useEffect(() => {
    const query = window.matchMedia("(max-width: 1023px)");
    const sync = () => setMobile(query.matches);
    sync();
    setPortalTarget(document.body);
    query.addEventListener("change", sync);
    return () => query.removeEventListener("change", sync);
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    readKnowledgeStatus(controller.signal).then(setStatus).catch((caught) => {
      if (!controller.signal.aborted) {
        setStatus((current) => ({
          ...current,
          message: caught instanceof Error ? caught.message : "Knowledge status could not be read.",
        }));
      }
    });
    return () => controller.abort();
  }, []);
  useEffect(() => () => abortRef.current?.abort(), []);
  useEffect(() => {
    if (open) window.setTimeout(() => inputRef.current?.focus(), 0);
  }, [open]);
  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [messages]);
  useEffect(() => {
    if (!open) return;
    const keydown = (event: globalThis.KeyboardEvent) => {
      if (event.key === "Escape") {
        if (evidenceOpen) setEvidenceOpen(false);
        else onClose();
      }
    };
    window.addEventListener("keydown", keydown);
    return () => window.removeEventListener("keydown", keydown);
  }, [evidenceOpen, onClose, open]);

  const stop = () => {
    abortRef.current?.abort();
    abortRef.current = null;
    setMessages((current) => current.map((message) => ({ ...message, pending: false })));
  };
  const clear = () => {
    stop();
    setMessages([]);
    setSelectedCitation(null);
    setEvidenceOpen(false);
    setError(null);
  };
  const openEvidence = (citation: KnowledgeCitation) => {
    setSelectedCitation(citation);
    setEvidenceOpen(true);
  };
  const ask = async (rawQuestion: string) => {
    const nextQuestion = rawQuestion.trim();
    if (!nextQuestion || busy || !status.available) return;
    setQuestion("");
    setError(null);
    const userMessage: KnowledgeMessage = {
      id: crypto.randomUUID(),
      role: "user",
      content: nextQuestion,
      citations: [],
    };
    const assistantId = crypto.randomUUID();
    const assistantMessage: KnowledgeMessage = {
      id: assistantId,
      role: "assistant",
      content: "",
      citations: [],
      pending: true,
      phase: "retrieving",
    };
    const history = messages
      .filter((message) => message.content && !message.pending)
      .slice(-10)
      .map(({ role, content }) => ({ role, content }));
    setMessages((current) => [...current, userMessage, assistantMessage]);
    const controller = new AbortController();
    abortRef.current = controller;
    try {
      await streamKnowledgeChat(
        {
          question: nextQuestion,
          history,
          context: useContext && context ? context : undefined,
        },
        (event) => {
          if (event.type === "error") {
            setError(event.message);
            return;
          }
          setMessages((current) =>
            current.map((message) => {
              if (message.id !== assistantId) return message;
              if (event.type === "status") return { ...message, phase: event.phase };
              if (event.type === "sources") {
                return { ...message, citations: event.citations, phase: "generating" };
              }
              if (event.type === "delta") {
                return { ...message, content: message.content + event.text };
              }
              if (event.type === "done") return { ...message, pending: false };
              return message;
            }),
          );
        },
        controller.signal,
      );
    } catch (caught) {
      if (!controller.signal.aborted) {
        setError(caught instanceof Error ? caught.message : "The knowledge assistant failed.");
      }
    } finally {
      setMessages((current) =>
        current.map((message) =>
          message.id === assistantId ? { ...message, pending: false } : message,
        ),
      );
      abortRef.current = null;
    }
  };

  const chatProps = {
    status,
    messages,
    question,
    contextSummary,
    useContext,
    error,
    busy,
    citations,
    inputRef,
    scrollRef,
    onQuestionChange: setQuestion,
    onUseContextChange: setUseContext,
    onAsk: (value: string) => void ask(value),
    onStop: stop,
    onClear: clear,
    onOpenEvidence: openEvidence,
  };

  if (!portalTarget) return null;

  const overlay = !open ? (
    <button
      ref={bubbleRef}
      type="button"
      aria-label="Ask COREY"
      title="Ask COREY — drag to move"
      aria-expanded={false}
      onPointerDown={(event) => bubblePosition.beginDrag(event, onOpen)}
      onClick={(event) => {
        if (event.detail === 0) onOpen();
      }}
      style={{
        position: "absolute",
        left: `${bubblePosition.point.x}px`,
        top: `${bubblePosition.point.y}px`,
        zoom: "calc(1 / 0.75)",
      }}
      className={`corey-canvas-mascot pointer-events-auto z-[80] cursor-grab touch-none rounded-full focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[color:var(--accent)] ${
        bubblePosition.dragging ? "cursor-grabbing" : ""
      }`}
    >
      <Image
        src="/corey-robot-builder.svg"
        alt=""
        width={72}
        height={72}
        aria-hidden="true"
        unoptimized
        className="relative z-10 h-[4.5rem] w-[4.5rem]"
      />
    </button>
  ) : (
    <section
      ref={panelRef}
      role="dialog"
      aria-modal="false"
      aria-label="Ask Corey"
      style={
        mobile
          ? { zoom: "calc(1 / 0.75)" }
          : {
              left: `${panelPosition.point.x}px`,
              top: `${panelPosition.point.y}px`,
              zoom: "calc(1 / 0.75)",
            }
      }
      className={`pointer-events-auto fixed z-[80] overflow-hidden rounded-[var(--r-panel)] border border-[color:var(--viewer-border)] bg-[color:var(--panel-bg)] shadow-[var(--viewer-shadow-lift)] ${
        mobile
          ? "inset-2 h-auto w-auto"
          : evidenceOpen
            ? "h-[min(46rem,calc(100vh_-_2rem))] w-[min(72rem,calc(100vw_-_2rem))]"
            : "h-[min(42rem,calc(100vh_-_2rem))] w-[min(36rem,calc(100vw_-_2rem))]"
      }`}
    >
      <div className="grid h-full min-h-0 grid-rows-[3.75rem_minmax(0,1fr)]">
        <header
          title={mobile ? undefined : "Drag to move Ask Corey"}
          onPointerDown={(event) => {
            if (mobile || (event.target as HTMLElement).closest("button, a, input, label")) return;
            panelPosition.beginDrag(event);
          }}
          className={`flex touch-none items-center gap-3 border-b border-[color:var(--viewer-border)] bg-[color:var(--surface-strong)] px-4 ${
            mobile ? "" : panelPosition.dragging ? "cursor-grabbing" : "cursor-grab"
          }`}
        >
          <div className="grid h-9 w-9 place-items-center bg-transparent">
            <CoreyGlyph size={28} />
          </div>
          <div className="min-w-0 flex-1">
            <div className="text-sm font-semibold text-[color:var(--foreground)]">Ask Corey</div>
            <div className="truncate text-[10px] text-[color:var(--muted-ink)]">
              {status.available ? "CORENET X submission assistant" : status.message}
            </div>
          </div>
          <button
            type="button"
            aria-label="Close Ask Corey"
            onClick={onClose}
            className="grid h-8 w-8 place-items-center rounded-[var(--r-control)] text-[color:var(--muted-ink)] transition hover:bg-[color:var(--surface-hover)] hover:text-[color:var(--foreground)]"
          >
            <X className="h-5 w-5" />
          </button>
        </header>

        <div className="min-h-0 lg:hidden">
          {evidenceOpen ? (
            <KnowledgeEvidencePanel
              citations={citations}
              selected={selectedCitation}
              onClose={() => setEvidenceOpen(false)}
              onSelect={openEvidence}
            />
          ) : (
            <ChatSurface {...chatProps} />
          )}
        </div>
        <div className="hidden min-h-0 lg:block">
          <Group orientation="horizontal" className="h-full">
            <Panel id="corey-chat" minSize="34%" defaultSize={evidenceOpen ? "44%" : "100%"}>
              <ChatSurface {...chatProps} />
            </Panel>
            {evidenceOpen ? (
              <>
                <Separator className="relative w-1.5 cursor-col-resize bg-[color:var(--viewer-border)] outline-none transition hover:bg-[color:var(--accent)] data-[resize-handle-active]:bg-[color:var(--accent)]">
                  <span className="absolute left-1/2 top-1/2 h-10 w-2 -translate-x-1/2 -translate-y-1/2" />
                </Separator>
                <Panel id="corey-evidence" minSize="38%" maxSize="66%" defaultSize="56%">
                  <KnowledgeEvidencePanel
                    citations={citations}
                    selected={selectedCitation}
                    onClose={() => setEvidenceOpen(false)}
                    onSelect={openEvidence}
                  />
                </Panel>
              </>
            ) : null}
          </Group>
        </div>
      </div>
    </section>
  );

  return createPortal(
    <div data-corey-overlay="true" className="pointer-events-none fixed inset-0 z-[80]">
      {overlay}
    </div>,
    portalTarget,
  );
}
