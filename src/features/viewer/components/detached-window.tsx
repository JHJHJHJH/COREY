"use client";

import { useEffect, useMemo, useRef, useSyncExternalStore } from "react";
import { createPortal } from "react-dom";

type DetachedWindowProps = {
  title: string;
  name: string;
  width: number;
  height: number;
  fullscreen?: boolean;
  preferExtendedScreen?: boolean;
  onClose: () => void;
  onOpenBlocked?: () => void;
  children: React.ReactNode;
};

type ScreenDetailedLike = {
  availLeft: number;
  availTop: number;
  availWidth: number;
  availHeight: number;
};

type ScreenDetailsLike = {
  currentScreen: ScreenDetailedLike | null;
  screens: ScreenDetailedLike[];
};

type WindowWithScreenDetails = Window & {
  getScreenDetails?: () => Promise<ScreenDetailsLike>;
};

type ScreenWithExtendedState = Screen & {
  isExtended?: boolean;
};

type PopupPlacement = {
  left: number;
  top: number;
  width: number;
  height: number;
};

function cloneDocumentStyles(source: Document, target: Document) {
  for (const node of source.head.querySelectorAll('style, link[rel="stylesheet"]')) {
    target.head.appendChild(node.cloneNode(true));
  }
}

function buildCurrentScreenPlacement(width: number, height: number, fullscreen: boolean): PopupPlacement {
  const currentScreen = window.screen as Screen & ScreenDetailedLike;

  return {
    left: fullscreen ? currentScreen.availLeft : Math.max(currentScreen.availLeft, window.screenX + 48),
    top: fullscreen ? currentScreen.availTop : Math.max(currentScreen.availTop, window.screenY + 48),
    width: fullscreen ? currentScreen.availWidth : width,
    height: fullscreen ? currentScreen.availHeight : height,
  };
}

function buildScreenPlacement(
  screen: ScreenDetailedLike,
  width: number,
  height: number,
  fullscreen: boolean,
): PopupPlacement {
  return {
    left: fullscreen ? screen.availLeft : screen.availLeft + 48,
    top: fullscreen ? screen.availTop : screen.availTop + 48,
    width: fullscreen ? screen.availWidth : width,
    height: fullscreen ? screen.availHeight : height,
  };
}

function isSameScreen(left: ScreenDetailedLike | null, right: ScreenDetailedLike) {
  if (!left) {
    return false;
  }

  return (
    left.availLeft === right.availLeft &&
    left.availTop === right.availTop &&
    left.availWidth === right.availWidth &&
    left.availHeight === right.availHeight
  );
}

async function resolvePopupPlacement({
  fullscreen,
  height,
  preferExtendedScreen,
  width,
}: {
  fullscreen: boolean;
  height: number;
  preferExtendedScreen: boolean;
  width: number;
}): Promise<PopupPlacement> {
  const fallbackPlacement = buildCurrentScreenPlacement(width, height, fullscreen);

  if (!preferExtendedScreen || (window.screen as ScreenWithExtendedState).isExtended !== true) {
    return fallbackPlacement;
  }

  const getScreenDetails = (window as WindowWithScreenDetails).getScreenDetails;
  if (typeof getScreenDetails !== "function") {
    return fallbackPlacement;
  }

  try {
    const details = await getScreenDetails.call(window);
    const targetScreen =
      details.screens.find((screen) => !isSameScreen(details.currentScreen, screen)) ?? null;
    if (!targetScreen) {
      return fallbackPlacement;
    }

    return buildScreenPlacement(targetScreen, width, height, fullscreen);
  } catch {
    return fallbackPlacement;
  }
}

export function DetachedWindow({
  title,
  name,
  width,
  height,
  fullscreen = false,
  preferExtendedScreen = false,
  onClose,
  onOpenBlocked,
  children,
}: DetachedWindowProps) {
  const container = useMemo(() => document.createElement("div"), []);
  const popupRef = useRef<Window | null>(null);
  const placementRef = useRef<PopupPlacement | null>(null);
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
    let closed = false;
    let nextPopup: Window | null = null;

    const handleBeforeUnload = () => {
      onClose();
    };

    const openPopup = async () => {
      const placement = await resolvePopupPlacement({
        fullscreen,
        height: initialHeightRef.current,
        preferExtendedScreen,
        width: initialWidthRef.current,
      });
      if (closed) {
        return;
      }

      placementRef.current = placement;
      nextPopup = window.open(
        "",
        name,
        [
          "popup=yes",
          `width=${Math.round(placement.width)}`,
          `height=${Math.round(placement.height)}`,
          `left=${Math.round(placement.left)}`,
          `top=${Math.round(placement.top)}`,
          "resizable=yes",
          "scrollbars=yes",
        ].join(","),
      );

      if (!nextPopup) {
        onOpenBlocked?.();
        return;
      }

      if (closed) {
        nextPopup.close();
        return;
      }

      popupRef.current = nextPopup;
      nextPopup.moveTo(Math.round(placement.left), Math.round(placement.top));
      nextPopup.resizeTo(Math.round(placement.width), Math.round(placement.height));
      nextPopup.document.title = initialTitleRef.current;
      nextPopup.document.body.innerHTML = "";
      nextPopup.document.head.innerHTML = "";
      cloneDocumentStyles(document, nextPopup.document);
      nextPopup.document.documentElement.className = document.documentElement.className;
      nextPopup.document.body.className = document.body.className;
      nextPopup.document.body.style.margin = "0";
      nextPopup.document.body.style.background = "var(--background)";
      nextPopup.document.body.appendChild(container);
      nextPopup.addEventListener("beforeunload", handleBeforeUnload);
      store.notify();
    };

    void openPopup();

    return () => {
      closed = true;
      if (nextPopup) {
        nextPopup.removeEventListener("beforeunload", handleBeforeUnload);
      }
      popupRef.current = null;
      store.notify();
      nextPopup?.close();
    };
  }, [container, fullscreen, name, onClose, onOpenBlocked, preferExtendedScreen]);

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

    if (fullscreen && placementRef.current) {
      popup.moveTo(Math.round(placementRef.current.left), Math.round(placementRef.current.top));
      popup.resizeTo(Math.round(placementRef.current.width), Math.round(placementRef.current.height));
      return;
    }

    popup.resizeTo(Math.round(width), Math.round(height));
  }, [fullscreen, height, width]);

  if (!ready) {
    return null;
  }

  return createPortal(children, container);
}
