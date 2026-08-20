// Transport replacement can reject an in-flight request after the server has
// already persisted it. Orchestration command ids make an identical retry
// idempotent, but a second interruption still has an unknown server outcome.
export function isAmbiguousOrchestrationDispatchFailure(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const candidate = error as { readonly code?: unknown; readonly retryable?: unknown };
  return candidate.code === "WS_REQUEST_RECONNECTED" && candidate.retryable === true;
}
