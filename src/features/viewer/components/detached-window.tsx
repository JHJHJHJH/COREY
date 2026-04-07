"use client";

import { useEffect, useMemo, useRef, useSyncExternalStore } from "react";
import { createPortal } from "react-dom";

type DetachedWindowProps = {
  title: string;
  name: string;
  width: number;
  height: number;
  onClose: () => void;
  onOpenBlocked?: () => void;
  children: React.ReactNode;
};

function cloneDocumentStyles(source: Document, target: Document) {
  for (const node of source.head.querySelectorAll('style, link[rel="stylesheet"]')) {
    target.head.appendChild(node.cloneNode(true));
  }
}

export function DetachedWindow({
  title,
  name,
  width,
  height,
  onClose,
  onOpenBlocked,
  children,
}: DetachedWindowProps) {
  const container = useMemo(() => document.createElement("div"), []);
  const popupRef = useRef<Window | null>(null);
  const initialWidthRef = useRef(width);
  const initialHeightRef = useRef(height);
  const initialTitleRef = useRef(title);
  const storeRef = useRef({
    listeners: new Set<() => void>(),
    notify() {
      for (const listener of this.listeners) {
        listener();
      }
    },
  });
  const ready = useSyncExternalStore(
    (listener) => {
      storeRef.current.listeners.add(listener);
      return () => {
        storeRef.current.listeners.delete(listener);
      };
    },
    () => {
      const popup = popupRef.current;
      return Boolean(popup && !popup.closed);
    },
    () => false,
  );

  useEffect(() => {
    const store = storeRef.current;
    const nextPopup = window.open(
      "",
      name,
      [
        "popup=yes",
        `width=${Math.round(initialWidthRef.current)}`,
        `height=${Math.round(initialHeightRef.current)}`,
        `left=${Math.max(0, window.screenX + 48)}`,
        `top=${Math.max(0, window.screenY + 48)}`,
        "resizable=yes",
        "scrollbars=yes",
      ].join(","),
    );

    if (!nextPopup) {
      onOpenBlocked?.();
      return;
    }

    popupRef.current = nextPopup;
    nextPopup.document.title = initialTitleRef.current;
    nextPopup.document.body.innerHTML = "";
    nextPopup.document.head.innerHTML = "";
    cloneDocumentStyles(document, nextPopup.document);
    nextPopup.document.documentElement.className = document.documentElement.className;
    nextPopup.document.body.className = document.body.className;
    nextPopup.document.body.style.margin = "0";
    nextPopup.document.body.style.background = "var(--background)";
    nextPopup.document.body.appendChild(container);

    const handleBeforeUnload = () => {
      onClose();
    };

    nextPopup.addEventListener("beforeunload", handleBeforeUnload);
    store.notify();

    return () => {
      nextPopup.removeEventListener("beforeunload", handleBeforeUnload);
      popupRef.current = null;
      store.notify();
      nextPopup.close();
    };
  }, [container, name, onClose, onOpenBlocked]);

  useEffect(() => {
    const popup = popupRef.current;
    if (!popup || popup.closed) {
      return;
    }

    popup.document.title = title;
  }, [title]);

  useEffect(() => {
    const popup = popupRef.current;
    if (!popup || popup.closed) {
      return;
    }

    popup.resizeTo(Math.round(width), Math.round(height));
  }, [height, width]);

  if (!ready) {
    return null;
  }

  return createPortal(children, container);
}
