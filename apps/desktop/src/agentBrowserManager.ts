// FILE: agentBrowserManager.ts
// Purpose: Owns the local agent-browser process/session bridge and relays its viewport to Electron.
// Layer: Desktop runtime service

import { execFile } from "node:child_process";
import * as FS from "node:fs";
import * as OS from "node:os";
import * as Path from "node:path";
import { promisify } from "node:util";

import type {
  AgentBrowserAckFrameInput,
  AgentBrowserEvent,
  AgentBrowserInputEvent,
  AgentBrowserNavigateInput,
  AgentBrowserSendInput,
  AgentBrowserStartInput,
  AgentBrowserTabInput,
  AgentBrowserThreadInput,
  AgentBrowserTabState,
  AgentBrowserViewportInput,
  ThreadAgentBrowserState,
  ThreadId,
} from "@synara/contracts";
import {
  buildSynaraAgentBrowserEnvironment,
  resolveSynaraAgentBrowserSessionName,
} from "@synara/shared/agentBrowser";

const execFileAsync = promisify(execFile);
const AGENT_BROWSER_COMMAND_TIMEOUT_MS = 30_000;
const AGENT_BROWSER_MAX_OUTPUT_BYTES = 10 * 1024 * 1024;
const AGENT_BROWSER_STREAM_FPS = 10;

interface AgentBrowserCliEnvelope<T> {
  success: boolean;
  data: T | null;
  error: string | null;
}

interface AgentBrowserStreamStatus {
  connected?: boolean;
  enabled?: boolean;
  port?: number;
}

interface AgentBrowserTabList {
  tabs?: Array<{
    active?: boolean;
    label?: string | null;
    tabId?: string;
    targetId?: string;
    title?: string;
    url?: string;
  }>;
}

interface AgentBrowserRuntime {
  state: ThreadAgentBrowserState;
  socket: WebSocket | null;
  streamPort: number | null;
  previewVisible: boolean;
  startPromise: Promise<ThreadAgentBrowserState> | null;
  pendingViewport: NormalizedViewport | null;
  resizePromise: Promise<void> | null;
}

interface NormalizedViewport {
  width: number;
  height: number;
  deviceScaleFactor: number;
}

export interface DesktopAgentBrowserManagerOptions {
  binaryPath?: string;
  env?: NodeJS.ProcessEnv;
  resourcesPath?: string;
  cwd?: string;
}

function executableFileName(): string {
  return process.platform === "win32" ? "agent-browser.exe" : "agent-browser";
}

function isExecutableFile(path: string): boolean {
  try {
    FS.accessSync(path, process.platform === "win32" ? FS.constants.F_OK : FS.constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

export function resolveAgentBrowserWorkingDirectory(path: string | undefined): string {
  const pointsInsideAsar =
    path?.endsWith(".asar") === true || path?.includes(`.asar${Path.sep}`) === true;
  if (path && !pointsInsideAsar) {
    try {
      if (FS.statSync(path).isDirectory()) return path;
    } catch {
      // Packaged entrypoints live inside app.asar, which is not a valid child cwd.
    }
  }
  return OS.homedir();
}

export function encodeAgentBrowserInputEvent(event: AgentBrowserInputEvent): string {
  const { type, ...payload } = event;
  return JSON.stringify({
    type: type === "mouse" ? "input_mouse" : "input_keyboard",
    ...payload,
  });
}

export function resolveAgentBrowserBinary(input: {
  explicitPath?: string;
  env?: NodeJS.ProcessEnv;
  resourcesPath?: string;
}): string | null {
  const env = input.env ?? process.env;
  const explicitPath = input.explicitPath?.trim() || env.SYNARA_AGENT_BROWSER_PATH?.trim();
  if (explicitPath) {
    return isExecutableFile(explicitPath) ? explicitPath : null;
  }

  const packagedName =
    process.platform === "darwin"
      ? `agent-browser-darwin-${process.arch === "arm64" ? "arm64" : "x64"}`
      : process.platform === "linux"
        ? `agent-browser-linux-${process.arch === "arm64" ? "arm64" : "x64"}`
        : executableFileName();
  const packagedCandidate = input.resourcesPath
    ? Path.join(input.resourcesPath, "agent-browser", packagedName)
    : null;
  if (packagedCandidate && isExecutableFile(packagedCandidate)) {
    return packagedCandidate;
  }

  const pathEntries = env.PATH?.split(Path.delimiter).filter(Boolean) ?? [];
  const names =
    process.platform === "win32"
      ? ["agent-browser.exe", "agent-browser.cmd", "agent-browser"]
      : ["agent-browser"];
  for (const directory of pathEntries) {
    for (const name of names) {
      const candidate = Path.join(directory, name);
      if (isExecutableFile(candidate)) return candidate;
    }
  }
  return null;
}

function initialState(threadId: ThreadId, available: boolean): ThreadAgentBrowserState {
  return {
    threadId,
    status: available ? "idle" : "unavailable",
    available,
    sessionName: resolveSynaraAgentBrowserSessionName(threadId),
    streamConnected: false,
    url: "about:blank",
    title: "Agent Browser",
    tabs: [],
    activeTabId: null,
    viewportWidth: 1280,
    viewportHeight: 720,
    lastError: available
      ? null
      : "agent-browser 0.34.0 is not installed or is not available on PATH.",
  };
}

function safeInitialUrl(value: string | undefined): string {
  const candidate = value?.trim();
  if (!candidate) return "about:blank";
  if (candidate === "about:blank") return candidate;
  try {
    const parsed = new URL(candidate);
    return parsed.protocol === "https:" || parsed.protocol === "http:"
      ? parsed.toString()
      : "about:blank";
  } catch {
    return "about:blank";
  }
}

function normalizeViewport(input: {
  width: number;
  height: number;
  deviceScaleFactor?: number;
}): NormalizedViewport {
  return {
    width: Math.max(320, Math.min(1920, Math.round(input.width))),
    height: Math.max(240, Math.min(1400, Math.round(input.height))),
    deviceScaleFactor: Math.max(1, Math.min(2, input.deviceScaleFactor ?? 1)),
  };
}

function normalizeTabs(value: AgentBrowserTabList): AgentBrowserTabState[] {
  return (value.tabs ?? []).flatMap((tab) => {
    if (!tab.tabId) return [];
    return [
      {
        id: tab.tabId,
        targetId: tab.targetId ?? null,
        title: tab.title?.trim() || tab.label?.trim() || tab.url?.trim() || "New tab",
        url: tab.url?.trim() || "about:blank",
        active: tab.active === true,
      },
    ];
  });
}

export class DesktopAgentBrowserManager {
  readonly #options: DesktopAgentBrowserManagerOptions;
  readonly #binaryPath: string | null;
  readonly #runtimes = new Map<ThreadId, AgentBrowserRuntime>();
  readonly #listeners = new Set<(event: AgentBrowserEvent) => void>();

  constructor(options: DesktopAgentBrowserManagerOptions = {}) {
    this.#options = options;
    this.#binaryPath = resolveAgentBrowserBinary({
      ...(options.binaryPath ? { explicitPath: options.binaryPath } : {}),
      ...(options.env ? { env: options.env } : {}),
      ...(options.resourcesPath ? { resourcesPath: options.resourcesPath } : {}),
    });
  }

  subscribe(listener: (event: AgentBrowserEvent) => void): () => void {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  getState(input: AgentBrowserThreadInput): ThreadAgentBrowserState {
    return this.#runtime(input.threadId).state;
  }

  async start(input: AgentBrowserStartInput): Promise<ThreadAgentBrowserState> {
    const runtime = this.#runtime(input.threadId);
    runtime.previewVisible = true;
    if (!this.#binaryPath) return runtime.state;
    if (runtime.startPromise) {
      await runtime.startPromise;
      if (input.viewportWidth && input.viewportHeight) {
        await this.setViewport({
          threadId: input.threadId,
          width: input.viewportWidth,
          height: input.viewportHeight,
        });
      }
      if (!runtime.socket && runtime.streamPort) this.#connectStream(runtime, runtime.streamPort);
      return runtime.state;
    }
    if (runtime.state.status === "running" && runtime.socket?.readyState === WebSocket.OPEN) {
      if (input.viewportWidth && input.viewportHeight) {
        return this.setViewport({
          threadId: input.threadId,
          width: input.viewportWidth,
          height: input.viewportHeight,
        });
      }
      return runtime.state;
    }

    runtime.startPromise = this.#startRuntime(
      runtime,
      safeInitialUrl(input.initialUrl),
      input.viewportWidth && input.viewportHeight
        ? normalizeViewport({ width: input.viewportWidth, height: input.viewportHeight })
        : null,
    ).finally(() => {
      runtime.startPromise = null;
    });
    return runtime.startPromise;
  }

  async stop(input: AgentBrowserThreadInput): Promise<ThreadAgentBrowserState> {
    const runtime = this.#runtime(input.threadId);
    this.#updateState(runtime, { status: "stopping", lastError: null });
    runtime.socket?.close();
    runtime.socket = null;
    runtime.streamPort = null;
    runtime.previewVisible = false;
    if (this.#binaryPath) {
      try {
        await this.#run(runtime.state.threadId, ["close", "--json"]);
      } catch (error) {
        this.#updateState(runtime, {
          status: "error",
          streamConnected: false,
          lastError: error instanceof Error ? error.message : String(error),
        });
        return runtime.state;
      }
    }
    this.#updateState(runtime, {
      status: this.#binaryPath ? "idle" : "unavailable",
      streamConnected: false,
      tabs: [],
      activeTabId: null,
      url: "about:blank",
      title: "Agent Browser",
      lastError: null,
    });
    return runtime.state;
  }

  sendInput(input: AgentBrowserSendInput): void {
    const socket = this.#runtime(input.threadId).socket;
    if (!socket || socket.readyState !== WebSocket.OPEN) return;
    socket.send(encodeAgentBrowserInputEvent(input.event));
  }

  suspendPreview(input: AgentBrowserThreadInput): void {
    const runtime = this.#runtime(input.threadId);
    runtime.previewVisible = false;
    const socket = runtime.socket;
    runtime.socket = null;
    socket?.close();
    if (runtime.state.streamConnected) {
      this.#updateState(runtime, { streamConnected: false });
    }
  }

  async setViewport(input: AgentBrowserViewportInput): Promise<ThreadAgentBrowserState> {
    const runtime = this.#runtime(input.threadId);
    runtime.pendingViewport = normalizeViewport(input);
    if (!runtime.resizePromise) {
      runtime.resizePromise = this.#drainViewportQueue(runtime).finally(() => {
        runtime.resizePromise = null;
        if (runtime.pendingViewport) {
          void this.setViewport({ threadId: input.threadId, ...runtime.pendingViewport });
        }
      });
    }
    await runtime.resizePromise;
    return runtime.state;
  }

  async navigate(input: AgentBrowserNavigateInput): Promise<ThreadAgentBrowserState> {
    await this.#run(input.threadId, ["open", safeInitialUrl(input.url), "--json"]);
    return this.#refreshTabs(this.#runtime(input.threadId));
  }

  async reload(input: AgentBrowserThreadInput): Promise<ThreadAgentBrowserState> {
    await this.#run(input.threadId, ["reload", "--json"]);
    return this.#refreshTabs(this.#runtime(input.threadId));
  }

  async goBack(input: AgentBrowserThreadInput): Promise<ThreadAgentBrowserState> {
    await this.#run(input.threadId, ["back", "--json"]);
    return this.#refreshTabs(this.#runtime(input.threadId));
  }

  async goForward(input: AgentBrowserThreadInput): Promise<ThreadAgentBrowserState> {
    await this.#run(input.threadId, ["forward", "--json"]);
    return this.#refreshTabs(this.#runtime(input.threadId));
  }

  async newTab(input: AgentBrowserTabInput): Promise<ThreadAgentBrowserState> {
    await this.#run(input.threadId, ["tab", "new", safeInitialUrl(input.initialUrl), "--json"]);
    return this.#refreshTabs(this.#runtime(input.threadId));
  }

  async closeTab(input: AgentBrowserTabInput): Promise<ThreadAgentBrowserState> {
    await this.#run(input.threadId, [
      "tab",
      "close",
      ...(input.tabId ? [input.tabId] : []),
      "--json",
    ]);
    return this.#refreshTabs(this.#runtime(input.threadId));
  }

  async selectTab(input: AgentBrowserTabInput): Promise<ThreadAgentBrowserState> {
    if (!input.tabId) return this.#runtime(input.threadId).state;
    await this.#run(input.threadId, ["tab", input.tabId, "--json"]);
    return this.#refreshTabs(this.#runtime(input.threadId));
  }

  ackFrame(input: AgentBrowserAckFrameInput): void {
    const socket = this.#runtime(input.threadId).socket;
    if (!socket || socket.readyState !== WebSocket.OPEN) return;
    socket.send(JSON.stringify({ type: "ack", seq: input.seq }));
  }

  async dispose(): Promise<void> {
    const threadIds = [...this.#runtimes.keys()];
    await Promise.allSettled(threadIds.map((threadId) => this.stop({ threadId })));
    this.#listeners.clear();
  }

  async #startRuntime(
    runtime: AgentBrowserRuntime,
    initialUrl: string,
    initialViewport: NormalizedViewport | null,
  ): Promise<ThreadAgentBrowserState> {
    this.#updateState(runtime, { status: "starting", lastError: null });
    try {
      let streamStatus = await this.#run<AgentBrowserStreamStatus>(runtime.state.threadId, [
        "stream",
        "status",
        "--json",
      ]);
      if (!streamStatus.connected) {
        await this.#run(runtime.state.threadId, ["open", initialUrl, "--json"]);
        streamStatus = await this.#run<AgentBrowserStreamStatus>(runtime.state.threadId, [
          "stream",
          "status",
          "--json",
        ]);
      }
      if (!streamStatus.enabled || !streamStatus.port) {
        await this.#run(runtime.state.threadId, ["stream", "enable", "--json"]);
      }
      const readyStatus =
        streamStatus.enabled && streamStatus.port
          ? streamStatus
          : await this.#run<AgentBrowserStreamStatus>(runtime.state.threadId, [
              "stream",
              "status",
              "--json",
            ]);
      if (!readyStatus.port) throw new Error("agent-browser did not publish a stream port.");
      runtime.streamPort = readyStatus.port;
      if (initialViewport) {
        await this.#applyViewport(runtime, initialViewport);
      }
      const tabList = await this.#run<AgentBrowserTabList>(runtime.state.threadId, [
        "tab",
        "list",
        "--json",
      ]);
      const tabs = normalizeTabs(tabList);
      const activeTab = tabs.find((tab) => tab.active) ?? tabs[0] ?? null;
      this.#updateState(runtime, {
        status: "running",
        tabs,
        activeTabId: activeTab?.id ?? null,
        url: activeTab?.url ?? initialUrl,
        title: activeTab?.title ?? "Agent Browser",
        lastError: null,
      });
      if (runtime.previewVisible) this.#connectStream(runtime, readyStatus.port);
    } catch (error) {
      this.#updateState(runtime, {
        status: "error",
        streamConnected: false,
        lastError: error instanceof Error ? error.message : String(error),
      });
    }
    return runtime.state;
  }

  #connectStream(runtime: AgentBrowserRuntime, port: number): void {
    runtime.socket?.close();
    const socket = new WebSocket(
      `ws://127.0.0.1:${port}/?pacing=ack&maxFps=${AGENT_BROWSER_STREAM_FPS}`,
    );
    runtime.socket = socket;
    socket.addEventListener("open", () => {
      this.#updateState(runtime, { streamConnected: true, status: "running", lastError: null });
    });
    socket.addEventListener("close", () => {
      if (runtime.socket !== socket) return;
      runtime.socket = null;
      this.#updateState(runtime, { streamConnected: false });
    });
    socket.addEventListener("error", () => {
      if (runtime.socket !== socket) return;
      this.#updateState(runtime, {
        streamConnected: false,
        lastError: "The agent-browser viewport stream disconnected.",
      });
    });
    socket.addEventListener("message", (event) => this.#handleStreamMessage(runtime, event.data));
  }

  #handleStreamMessage(runtime: AgentBrowserRuntime, data: unknown): void {
    let message: Record<string, unknown>;
    try {
      message = JSON.parse(typeof data === "string" ? data : String(data)) as Record<
        string,
        unknown
      >;
    } catch {
      return;
    }
    if (message.type === "frame") {
      const metadata =
        typeof message.metadata === "object" && message.metadata !== null
          ? (message.metadata as Record<string, unknown>)
          : {};
      if (typeof message.seq !== "number" || typeof message.data !== "string") return;
      const width = typeof metadata.deviceWidth === "number" ? metadata.deviceWidth : 1280;
      const height = typeof metadata.deviceHeight === "number" ? metadata.deviceHeight : 720;
      if (width !== runtime.state.viewportWidth || height !== runtime.state.viewportHeight) {
        this.#updateState(runtime, { viewportWidth: width, viewportHeight: height });
      }
      this.#emit({
        type: "frame",
        threadId: runtime.state.threadId,
        seq: message.seq,
        data: message.data,
        mimeType: "image/jpeg",
        width,
        height,
        timestamp: typeof metadata.timestamp === "number" ? metadata.timestamp : Date.now(),
      });
      return;
    }
    if (message.type === "url" && typeof message.url === "string") {
      this.#updateState(runtime, {
        url: message.url,
        tabs: runtime.state.tabs.map((tab) =>
          tab.active ? { ...tab, url: message.url as string } : tab,
        ),
      });
      return;
    }
    if (message.type === "tabs" && Array.isArray(message.tabs)) {
      const tabs = normalizeTabs({
        tabs: message.tabs as NonNullable<AgentBrowserTabList["tabs"]>,
      });
      const activeTab = tabs.find((tab) => tab.active) ?? tabs[0] ?? null;
      this.#updateState(runtime, {
        tabs,
        activeTabId: activeTab?.id ?? null,
        ...(activeTab ? { url: activeTab.url, title: activeTab.title } : {}),
      });
      return;
    }
    if (message.type === "status") {
      const viewport =
        typeof message.viewport === "object" && message.viewport !== null
          ? (message.viewport as Record<string, unknown>)
          : message;
      const width = viewport.width ?? viewport.deviceWidth;
      const height = viewport.height ?? viewport.deviceHeight;
      if (typeof width === "number" && typeof height === "number") {
        this.#updateState(runtime, { viewportWidth: width, viewportHeight: height });
      }
    }
  }

  async #drainViewportQueue(runtime: AgentBrowserRuntime): Promise<void> {
    while (runtime.pendingViewport) {
      const viewport = runtime.pendingViewport;
      runtime.pendingViewport = null;
      await this.#applyViewport(runtime, viewport);
    }
  }

  async #applyViewport(runtime: AgentBrowserRuntime, viewport: NormalizedViewport): Promise<void> {
    await this.#run(runtime.state.threadId, [
      "set",
      "viewport",
      String(viewport.width),
      String(viewport.height),
      String(viewport.deviceScaleFactor),
      "--json",
    ]);
    this.#updateState(runtime, {
      viewportWidth: viewport.width,
      viewportHeight: viewport.height,
    });
  }

  async #refreshTabs(runtime: AgentBrowserRuntime): Promise<ThreadAgentBrowserState> {
    const tabList = await this.#run<AgentBrowserTabList>(runtime.state.threadId, [
      "tab",
      "list",
      "--json",
    ]);
    const tabs = normalizeTabs(tabList);
    const activeTab = tabs.find((tab) => tab.active) ?? tabs[0] ?? null;
    this.#updateState(runtime, {
      tabs,
      activeTabId: activeTab?.id ?? null,
      url: activeTab?.url ?? "about:blank",
      title: activeTab?.title ?? "Agent Browser",
    });
    return runtime.state;
  }

  async #run<T>(threadId: ThreadId, args: string[]): Promise<T> {
    if (!this.#binaryPath) throw new Error("agent-browser is unavailable.");
    const env = {
      ...process.env,
      ...this.#options.env,
      ...buildSynaraAgentBrowserEnvironment(threadId),
    };
    let stdout: string;
    try {
      const result = await execFileAsync(this.#binaryPath, args, {
        cwd: resolveAgentBrowserWorkingDirectory(this.#options.cwd),
        env,
        timeout: AGENT_BROWSER_COMMAND_TIMEOUT_MS,
        maxBuffer: AGENT_BROWSER_MAX_OUTPUT_BYTES,
        windowsHide: true,
      });
      stdout = result.stdout;
    } catch (error) {
      const detail =
        typeof error === "object" && error !== null && "stderr" in error
          ? String((error as { stderr?: unknown }).stderr ?? "").trim()
          : "";
      throw new Error(detail || (error instanceof Error ? error.message : String(error)));
    }
    const raw = stdout.trim();
    const envelope = JSON.parse(raw) as AgentBrowserCliEnvelope<T>;
    if (!envelope.success || envelope.data === null) {
      throw new Error(envelope.error?.trim() || "agent-browser command failed.");
    }
    return envelope.data;
  }

  #runtime(threadId: ThreadId): AgentBrowserRuntime {
    const existing = this.#runtimes.get(threadId);
    if (existing) return existing;
    const runtime: AgentBrowserRuntime = {
      state: initialState(threadId, this.#binaryPath !== null),
      socket: null,
      streamPort: null,
      previewVisible: false,
      startPromise: null,
      pendingViewport: null,
      resizePromise: null,
    };
    this.#runtimes.set(threadId, runtime);
    return runtime;
  }

  #updateState(
    runtime: AgentBrowserRuntime,
    patch: Partial<Omit<ThreadAgentBrowserState, "threadId" | "sessionName" | "available">>,
  ): void {
    runtime.state = { ...runtime.state, ...patch };
    this.#emit({ type: "state", state: runtime.state });
  }

  #emit(event: AgentBrowserEvent): void {
    for (const listener of this.#listeners) listener(event);
  }
}
