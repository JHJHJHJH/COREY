"use client";

import { Grip } from "lucide-react";
import { useRouter } from "next/navigation";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type PointerEvent as ReactPointerEvent,
} from "react";
import { RulesScreen } from "@/features/rules/components/rules-screen";

type RulesModalProps = {
  onClose?: () => void;
};

type RulesModalSize = {
  width: number;
  height: number;
};

type RulesModalResizeState = {
  startX: number;
  startY: number;
  startWidth: number;
  startHeight: number;
};

const MIN_RULES_MODAL_WIDTH = 480;
const MIN_RULES_MODAL_HEIGHT = 360;
const RULES_MODAL_MOBILE_HORIZONTAL_PADDING = 32;
const RULES_MODAL_DESKTOP_HORIZONTAL_PADDING = 48;
const RULES_MODAL_VERTICAL_PADDING = 32;
const RULES_MODAL_KEYBOARD_STEP = 24;
const RULES_MODAL_KEYBOARD_LARGE_STEP = 80;

function clampRulesModalSize(size: RulesModalSize): RulesModalSize {
  if (typeof window === "undefined") {
    return size;
  }

  const horizontalPadding =
    window.innerWidth >= 640
      ? RULES_MODAL_DESKTOP_HORIZONTAL_PADDING
      : RULES_MODAL_MOBILE_HORIZONTAL_PADDING;
  const maxWidth = Math.max(280, window.innerWidth - horizontalPadding);
  const maxHeight = Math.max(280, window.innerHeight - RULES_MODAL_VERTICAL_PADDING);
  const minWidth = Math.min(MIN_RULES_MODAL_WIDTH, maxWidth);
  const minHeight = Math.min(MIN_RULES_MODAL_HEIGHT, maxHeight);

  return {
    width: Math.min(maxWidth, Math.max(minWidth, size.width)),
    height: Math.min(maxHeight, Math.max(minHeight, size.height)),
  };
}

export function RulesModal({ onClose }: RulesModalProps) {
  const router = useRouter();
  const close = onClose ?? (() => router.back());
  const modalRef = useRef<HTMLDivElement | null>(null);
  const resizeStateRef = useRef<RulesModalResizeState | null>(null);
  const [modalSize, setModalSize] = useState<RulesModalSize | null>(null);
  const [isResizing, setIsResizing] = useState(false);

  const commitModalSizeChange = useCallback(
    (deltaWidth: number, deltaHeight: number) => {
      const currentSize =
        modalSize ??
        (modalRef.current
          ? {
              width: modalRef.current.getBoundingClientRect().width,
              height: modalRef.current.getBoundingClientRect().height,
            }
          : null);

      if (!currentSize) {
        return;
      }

      setModalSize(
        clampRulesModalSize({
          width: currentSize.width + deltaWidth,
          height: currentSize.height + deltaHeight,
        }),
      );
    },
    [modalSize],
  );

  const startResize = useCallback((event: ReactPointerEvent<HTMLButtonElement>) => {
    if (event.button !== 0) {
      return;
    }

    const rect = modalRef.current?.getBoundingClientRect();
    if (!rect) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();
    resizeStateRef.current = {
      startX: event.clientX,
      startY: event.clientY,
      startWidth: rect.width,
      startHeight: rect.height,
    };
    setModalSize({ width: rect.width, height: rect.height });
    setIsResizing(true);
  }, []);

  const handleResizeKeyDown = useCallback(
    (event: KeyboardEvent<HTMLButtonElement>) => {
      const step = event.shiftKey ? RULES_MODAL_KEYBOARD_LARGE_STEP : RULES_MODAL_KEYBOARD_STEP;
      let deltaWidth = 0;
      let deltaHeight = 0;

      if (event.key === "ArrowRight") {
        deltaWidth = step;
      } else if (event.key === "ArrowLeft") {
        deltaWidth = -step;
      } else if (event.key === "ArrowDown") {
        deltaHeight = step;
      } else if (event.key === "ArrowUp") {
        deltaHeight = -step;
      } else {
        return;
      }

      event.preventDefault();
      event.stopPropagation();
      commitModalSizeChange(deltaWidth, deltaHeight);
    },
    [commitModalSizeChange],
  );

  useEffect(() => {
    const handleResize = () => {
      setModalSize((current) => (current ? clampRulesModalSize(current) : current));
    };

    window.addEventListener("resize", handleResize);
    return () => {
      window.removeEventListener("resize", handleResize);
    };
  }, []);

  useEffect(() => {
    if (!isResizing) {
      return;
    }

    const handlePointerMove = (event: PointerEvent) => {
      const resizeState = resizeStateRef.current;
      if (!resizeState) {
        return;
      }

      event.preventDefault();
      setModalSize(
        clampRulesModalSize({
          width: resizeState.startWidth + (event.clientX - resizeState.startX) * 2,
          height: resizeState.startHeight + (event.clientY - resizeState.startY) * 2,
        }),
      );
    };

    const stopResize = () => {
      resizeStateRef.current = null;
      setIsResizing(false);
    };

    document.body.style.cursor = "nwse-resize";
    document.body.style.userSelect = "none";
    window.addEventListener("pointermove", handlePointerMove);
    window.addEventListener("pointerup", stopResize);
    window.addEventListener("pointercancel", stopResize);

    return () => {
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", stopResize);
      window.removeEventListener("pointercancel", stopResize);
      document.body.style.removeProperty("cursor");
      document.body.style.removeProperty("user-select");
    };
  }, [isResizing]);

  return (
    <div
      className="fixed inset-0 z-[70] flex items-center justify-center overflow-hidden bg-[rgba(20,24,21,0.42)] px-4 py-4 backdrop-blur-[2px] sm:px-6"
      onClick={close}
    >
      <div
        ref={modalRef}
        className={`relative overflow-hidden rounded-[1.75rem] ${
          modalSize
            ? ""
            : "h-[min(calc(100vh-2rem),64rem)] w-[min(calc(100vw-2rem),112rem)] sm:w-[min(calc(100vw-3rem),112rem)]"
        }`}
        style={{
          width: modalSize ? `${modalSize.width}px` : undefined,
          height: modalSize ? `${modalSize.height}px` : undefined,
          minWidth: "min(30rem, calc(100vw - 2rem))",
          minHeight: "min(22.5rem, calc(100vh - 2rem))",
          maxWidth: "calc(100vw - 2rem)",
          maxHeight: "calc(100vh - 2rem)",
        }}
        onClick={(event) => event.stopPropagation()}
      >
        <RulesScreen mode="modal" onClose={close} />
        <button
          type="button"
          aria-label="Resize clause window"
          title="Resize clause window"
          onPointerDown={startResize}
          onKeyDown={handleResizeKeyDown}
          onClick={(event) => event.stopPropagation()}
          className={`absolute bottom-1 right-1 z-20 flex h-6 w-6 cursor-nwse-resize touch-none items-center justify-center rounded-lg border border-[color:var(--viewer-border)] bg-[color:var(--surface-soft)]/90 text-[color:var(--muted-ink)] shadow-sm backdrop-blur transition hover:text-[color:var(--foreground)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[color:var(--accent)] ${
            isResizing ? "text-[color:var(--foreground)]" : ""
          }`}
        >
          <Grip className="h-3.5 w-3.5" />
        </button>
      </div>
    </div>
  );
}
