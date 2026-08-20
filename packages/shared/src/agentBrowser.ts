// FILE: agentBrowser.ts
// Purpose: Keeps Synara's Codex process and desktop preview on the same agent-browser session.
// Layer: Shared pure runtime naming helpers

export const SYNARA_AGENT_BROWSER_NAMESPACE = "synara";
export const SYNARA_AGENT_BROWSER_IDLE_TIMEOUT_MS = 10 * 60 * 1000;

export function resolveSynaraAgentBrowserSessionName(threadId: string): string {
  const normalized = threadId
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "-")
    .replace(/^-+|-+$/g, "");
  if (!normalized) return "synara-thread";
  if (normalized.length <= 24) return `synara-${normalized}`;
  // agent-browser uses a Unix-domain socket whose full filesystem path is capped
  // at 103 bytes on macOS. Preserve both ends of UUID-like thread ids while keeping
  // enough room for the namespace and runtime directory.
  return `synara-${normalized.slice(0, 12)}-${normalized.slice(-8)}`;
}

export function buildSynaraAgentBrowserEnvironment(threadId: string): Record<string, string> {
  return {
    AGENT_BROWSER_SESSION: resolveSynaraAgentBrowserSessionName(threadId),
    AGENT_BROWSER_NAMESPACE: SYNARA_AGENT_BROWSER_NAMESPACE,
    AGENT_BROWSER_IDLE_TIMEOUT_MS: String(SYNARA_AGENT_BROWSER_IDLE_TIMEOUT_MS),
    AGENT_BROWSER_STREAM_QUALITY: "65",
    AGENT_BROWSER_STREAM_MAX_WIDTH: "1440",
    AGENT_BROWSER_STREAM_MAX_HEIGHT: "1000",
  };
}
