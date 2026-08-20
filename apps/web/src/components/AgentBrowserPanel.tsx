// FILE: AgentBrowserPanel.tsx
// Purpose: Native right-dock viewport and takeover controls for Codex-owned agent-browser sessions.
// Layer: Web desktop UI

import type {
  AgentBrowserEvent,
  AgentBrowserInputEvent,
  ThreadAgentBrowserState,
  ThreadId,
} from "@synara/contracts";
import {
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent as ReactMouseEvent,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";

import {
  ArrowLeftIcon,
  ArrowRightIcon,
  BotIcon,
  DevicePowerIcon,
  PlusIcon,
  PlayIcon,
  RefreshCwIcon,
  XIcon,
} from "~/lib/icons";
import { cn } from "~/lib/utils";
import { Button } from "./ui/button";
import { Input } from "./ui/input";

interface AgentBrowserPanelProps {
  threadId: ThreadId;
  runtimeMode?: "live" | "preview";
  isVisible?: boolean;
  onRequestLive?: () => void;
}

interface AgentBrowserFrame {
  seq: number;
  data: string;
}

function unavailableState(threadId: ThreadId): ThreadAgentBrowserState {
  return {
    threadId,
    status: "unavailable",
    available: false,
    sessionName: "",
    streamConnected: false,
    url: "about:blank",
    title: "Agent Browser",
    tabs: [],
    activeTabId: null,
    viewportWidth: 1280,
    viewportHeight: 720,
    lastError: "Agent Browser is available in the installed Synara desktop app.",
  };
}

export function resolveAgentBrowserPointerCoordinates(input: {
  clientX: number;
  clientY: number;
  bounds: { left: number; top: number; width: number; height: number };
  viewportWidth: number;
  viewportHeight: number;
}): { x: number; y: number } | null {
  const { bounds } = input;
  const viewportAspect = input.viewportWidth / input.viewportHeight;
  const boundsAspect = bounds.width / bounds.height;
  const contentWidth =
    boundsAspect > viewportAspect ? bounds.height * viewportAspect : bounds.width;
  const contentHeight =
    boundsAspect > viewportAspect ? bounds.height : bounds.width / viewportAspect;
  const contentLeft = bounds.left + (bounds.width - contentWidth) / 2;
  const contentTop = bounds.top + (bounds.height - contentHeight) / 2;
  if (
    input.clientX < contentLeft ||
    input.clientX > contentLeft + contentWidth ||
    input.clientY < contentTop ||
    input.clientY > contentTop + contentHeight
  ) {
    return null;
  }
  return {
    x: ((input.clientX - contentLeft) / contentWidth) * input.viewportWidth,
    y: ((input.clientY - contentTop) / contentHeight) * input.viewportHeight,
  };
}

function eventCoordinates(
  event: ReactMouseEvent<HTMLDivElement>,
  state: ThreadAgentBrowserState,
  image: HTMLImageElement | null,
): { x: number; y: number } | null {
  return resolveAgentBrowserPointerCoordinates({
    clientX: event.clientX,
    clientY: event.clientY,
    bounds: image?.getBoundingClientRect() ?? event.currentTarget.getBoundingClientRect(),
    viewportWidth: state.viewportWidth,
    viewportHeight: state.viewportHeight,
  });
}

function normalizeAddress(value: string): string {
  const candidate = value.trim();
  if (!candidate) return "about:blank";
  if (candidate === "about:blank") return candidate;
  try {
    return new URL(candidate).toString();
  } catch {
    try {
      return new URL(`https://${candidate}`).toString();
    } catch {
      return `https://www.google.com/search?q=${encodeURIComponent(candidate)}`;
    }
  }
}

function mouseButton(button: number): "left" | "middle" | "right" {
  if (button === 1) return "middle";
  if (button === 2) return "right";
  return "left";
}

export function AgentBrowserPanel({
  threadId,
  runtimeMode = "live",
  isVisible = true,
  onRequestLive,
}: AgentBrowserPanelProps) {
  const bridge = window.desktopBridge?.agentBrowser;
  const [state, setState] = useState<ThreadAgentBrowserState>(() => unavailableState(threadId));
  const [frame, setFrame] = useState<AgentBrowserFrame | null>(null);
  const [takeover, setTakeover] = useState(false);
  const [addressValue, setAddressValue] = useState("about:blank");
  const surfaceRef = useRef<HTMLDivElement | null>(null);
  const viewportRef = useRef<HTMLDivElement | null>(null);
  const imageRef = useRef<HTMLImageElement | null>(null);
  const stateRef = useRef(state);
  const isVisibleRef = useRef(isVisible);
  const isAddressEditingRef = useRef(false);
  const measuredViewportRef = useRef<{ width: number; height: number } | null>(null);
  const isLive = runtimeMode === "live";
  stateRef.current = state;
  isVisibleRef.current = isVisible;

  useEffect(() => {
    setState(unavailableState(threadId));
    setFrame(null);
    setTakeover(false);
    setAddressValue("about:blank");
    if (!bridge || !isLive) return;
    let active = true;
    void bridge.getState({ threadId }).then((next) => {
      if (!active) return;
      setState(next);
      setAddressValue(next.url);
    });
    const unsubscribe = bridge.onEvent((event: AgentBrowserEvent) => {
      if (event.type === "state") {
        if (event.state.threadId === threadId) {
          setState(event.state);
          if (!isAddressEditingRef.current) setAddressValue(event.state.url);
        }
        return;
      }
      if (event.threadId !== threadId || !isVisibleRef.current) return;
      setFrame({
        seq: event.seq,
        data: event.data,
      });
    });
    return () => {
      active = false;
      unsubscribe();
    };
  }, [bridge, isLive, threadId]);

  useEffect(() => {
    if (!bridge || !isLive) return;
    if (!isVisible) {
      setFrame(null);
      void bridge.suspendPreview({ threadId });
      return;
    }
    let active = true;
    const bounds = surfaceRef.current?.getBoundingClientRect();
    const measured =
      bounds && bounds.width > 0 && bounds.height > 0
        ? { width: Math.round(bounds.width), height: Math.round(bounds.height) }
        : measuredViewportRef.current;
    void bridge
      .start({
        threadId,
        ...(measured ? { viewportWidth: measured.width, viewportHeight: measured.height } : {}),
      })
      .then((next) => {
        if (active) setState(next);
      });
    return () => {
      active = false;
      void bridge.suspendPreview({ threadId });
    };
  }, [bridge, isLive, isVisible, threadId]);

  useEffect(() => {
    const surface = surfaceRef.current;
    if (!bridge || !surface || !isLive || !isVisible) return;
    let timer: number | null = null;
    let lastKey = "";
    const schedule = (width: number, height: number) => {
      const next = { width: Math.round(width), height: Math.round(height) };
      if (next.width < 1 || next.height < 1) return;
      measuredViewportRef.current = next;
      const key = `${next.width}x${next.height}`;
      if (key === lastKey) return;
      lastKey = key;
      if (timer !== null) window.clearTimeout(timer);
      timer = window.setTimeout(() => {
        timer = null;
        if (stateRef.current.status !== "running") return;
        void bridge.setViewport({ threadId, ...next });
      }, 120);
    };
    const observer = new ResizeObserver((entries) => {
      const entry = entries[entries.length - 1];
      if (entry) schedule(entry.contentRect.width, entry.contentRect.height);
    });
    observer.observe(surface);
    const bounds = surface.getBoundingClientRect();
    schedule(bounds.width, bounds.height);
    return () => {
      observer.disconnect();
      if (timer !== null) window.clearTimeout(timer);
    };
  }, [bridge, isLive, isVisible, threadId]);

  const start = useCallback(() => {
    if (!bridge) return;
    onRequestLive?.();
    const measured = measuredViewportRef.current;
    void bridge
      .start({
        threadId,
        ...(measured ? { viewportWidth: measured.width, viewportHeight: measured.height } : {}),
      })
      .then(setState);
  }, [bridge, onRequestLive, threadId]);

  const stop = useCallback(() => {
    if (!bridge) return;
    setTakeover(false);
    setFrame(null);
    void bridge.stop({ threadId }).then(setState);
  }, [bridge, threadId]);

  const sendInput = useCallback(
    (event: AgentBrowserInputEvent) => {
      if (!bridge || !takeover) return;
      void bridge.sendInput({ threadId, event });
    },
    [bridge, takeover, threadId],
  );

  const onPointer = useCallback(
    (
      event: ReactMouseEvent<HTMLDivElement>,
      eventType: "mouseMoved" | "mousePressed" | "mouseReleased",
    ) => {
      if (!takeover) return;
      if (eventType === "mousePressed") {
        event.currentTarget.focus();
      }
      const point = eventCoordinates(event, state, imageRef.current);
      if (!point) return;
      sendInput({
        type: "mouse",
        eventType,
        ...point,
        button: mouseButton(event.button),
        clickCount: event.detail || 1,
      });
    },
    [sendInput, state, takeover],
  );

  const onKey = useCallback(
    (event: ReactKeyboardEvent<HTMLDivElement>, eventType: "keyDown" | "keyUp") => {
      if (!takeover || event.metaKey) return;
      event.preventDefault();
      sendInput({
        type: "keyboard",
        eventType,
        key: event.key,
        ...(eventType === "keyDown" && event.key.length === 1 ? { text: event.key } : {}),
      });
    },
    [sendInput, takeover],
  );

  const running = state.status === "running" || state.status === "starting";

  const runControl = useCallback((operation: Promise<ThreadAgentBrowserState>) => {
    void operation.then(setState).catch((error) => {
      setState((current) => ({
        ...current,
        lastError: error instanceof Error ? error.message : String(error),
      }));
    });
  }, []);

  if (!isLive) {
    return (
      <div className="flex h-full items-center justify-center p-6 text-center text-sm text-muted-foreground">
        <Button variant="secondary" size="sm" onClick={onRequestLive}>
          <PlayIcon /> Wake Agent Browser
        </Button>
      </div>
    );
  }

  return (
    <section className="flex h-full min-h-0 min-w-0 flex-1 flex-col bg-card" aria-label="Browser">
      <header className="flex min-h-10 items-center gap-1 border-b border-border px-2">
        <Button
          variant="chrome"
          size="icon-xs"
          disabled={!running || !bridge}
          aria-label="Go back"
          onClick={() => bridge && runControl(bridge.goBack({ threadId }))}
        >
          <ArrowLeftIcon />
        </Button>
        <Button
          variant="chrome"
          size="icon-xs"
          disabled={!running || !bridge}
          aria-label="Go forward"
          onClick={() => bridge && runControl(bridge.goForward({ threadId }))}
        >
          <ArrowRightIcon />
        </Button>
        <Button
          variant="chrome"
          size="icon-xs"
          disabled={!running || !bridge}
          aria-label="Reload"
          onClick={() => bridge && runControl(bridge.reload({ threadId }))}
        >
          <RefreshCwIcon />
        </Button>
        <form
          className="min-w-0 flex-1"
          onSubmit={(event) => {
            event.preventDefault();
            if (!bridge) return;
            const url = normalizeAddress(addressValue);
            isAddressEditingRef.current = false;
            setAddressValue(url);
            runControl(bridge.navigate({ threadId, url }));
          }}
        >
          <Input
            value={addressValue}
            onChange={(event) => setAddressValue(event.currentTarget.value)}
            onFocus={() => {
              isAddressEditingRef.current = true;
            }}
            onBlur={() => {
              isAddressEditingRef.current = false;
              setAddressValue(stateRef.current.url);
            }}
            aria-label="Browser address"
            className="h-7 rounded-lg text-xs"
            disabled={!running}
          />
        </form>
        {running ? (
          <>
            <Button
              variant="chrome"
              size="icon-xs"
              onClick={() => bridge && runControl(bridge.newTab({ threadId }))}
              aria-label="New browser tab"
            >
              <PlusIcon />
            </Button>
            <Button
              variant={takeover ? "primary-outline" : "chrome-outline"}
              size="xs"
              onClick={() => {
                setTakeover((current) => !current);
                queueMicrotask(() => viewportRef.current?.focus());
              }}
            >
              {takeover ? "Preview only" : "Interact"}
            </Button>
            <Button variant="chrome" size="icon-xs" onClick={stop} aria-label="Stop Agent Browser">
              <DevicePowerIcon />
            </Button>
          </>
        ) : (
          <Button variant="secondary" size="xs" onClick={start} disabled={!state.available}>
            <PlayIcon /> Start
          </Button>
        )}
      </header>

      {state.tabs.length > 1 ? (
        <div className="flex min-h-8 items-center gap-1 overflow-x-auto border-b border-border px-2 py-1">
          {state.tabs.map((tab) => (
            <div
              key={tab.id}
              className={cn(
                "flex h-6 max-w-44 shrink-0 items-center rounded-md border px-1 text-[10px]",
                tab.active
                  ? "border-border bg-background/80"
                  : "border-transparent text-muted-foreground",
              )}
            >
              <button
                type="button"
                className="min-w-0 flex-1 truncate px-1 text-left"
                onClick={() => bridge && runControl(bridge.selectTab({ threadId, tabId: tab.id }))}
              >
                {tab.title || "New tab"}
              </button>
              <button
                type="button"
                className="rounded p-0.5 hover:bg-muted"
                aria-label={`Close ${tab.title || "browser tab"}`}
                onClick={() => bridge && runControl(bridge.closeTab({ threadId, tabId: tab.id }))}
              >
                <XIcon className="size-3" />
              </button>
            </div>
          ))}
        </div>
      ) : null}

      {state.lastError ? (
        <div className="border-b border-destructive/20 bg-destructive/5 px-3 py-2 text-xs text-destructive">
          {state.lastError}
        </div>
      ) : null}

      <div ref={surfaceRef} className="relative min-h-0 flex-1 overflow-hidden bg-black/95">
        {frame ? (
          <div
            ref={viewportRef}
            role="application"
            aria-label={takeover ? "Interactive Agent Browser viewport" : "Agent Browser preview"}
            tabIndex={takeover ? 0 : -1}
            className={cn(
              "absolute inset-0 flex items-center justify-center outline-none",
              takeover && "cursor-default ring-2 ring-inset ring-primary/70",
            )}
            onMouseDown={(event) => onPointer(event, "mousePressed")}
            onMouseMove={(event) => onPointer(event, "mouseMoved")}
            onMouseUp={(event) => onPointer(event, "mouseReleased")}
            onContextMenu={(event) => takeover && event.preventDefault()}
            onKeyDown={(event) => onKey(event, "keyDown")}
            onKeyUp={(event) => onKey(event, "keyUp")}
          >
            <img
              ref={imageRef}
              src={`data:image/jpeg;base64,${frame.data}`}
              alt="Live Agent Browser viewport"
              draggable={false}
              className="h-full w-full select-none object-contain"
              onLoad={() => void bridge?.ackFrame({ threadId, seq: frame.seq })}
            />
            {!takeover ? (
              <div className="pointer-events-none absolute bottom-3 rounded-full bg-black/70 px-3 py-1 text-[10px] text-white/80">
                Codex session · preview only
              </div>
            ) : null}
          </div>
        ) : (
          <div className="flex h-full flex-col items-center justify-center gap-3 p-6 text-center text-sm text-white/65">
            {state.status === "starting" ? (
              <>
                <RefreshCwIcon className="size-5 animate-spin" />
                Starting the agent browser…
              </>
            ) : state.available ? (
              <>
                <BotIcon className="size-8 text-white/45" />
                <div>
                  <p className="font-medium text-white/85">Browser session is idle</p>
                  <p className="mt-1 text-xs">Start it here, then ask Codex to browse.</p>
                </div>
                <Button variant="secondary" size="sm" onClick={start}>
                  <PlayIcon /> Start Agent Browser
                </Button>
              </>
            ) : (
              <div>
                <p className="font-medium text-white/85">Agent Browser is not installed</p>
                <p className="mt-1 text-xs">Install agent-browser 0.34.0 and relaunch Synara.</p>
              </div>
            )}
          </div>
        )}
      </div>
    </section>
  );
}

export default AgentBrowserPanel;
