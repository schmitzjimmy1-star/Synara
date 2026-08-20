import { Effect, Stream } from "effect";
import { HttpServerRequest } from "effect/unstable/http";

const BODY_TOO_LARGE = Symbol("McpBodyTooLarge");

export type McpBodyReadResult =
  | { readonly kind: "ok"; readonly body: unknown }
  | { readonly kind: "invalid" }
  | { readonly kind: "too-large" };

export function readMcpJsonBody(
  request: HttpServerRequest.HttpServerRequest,
  maxBytes: number,
): Effect.Effect<McpBodyReadResult> {
  const declaredLength = Number.parseInt(request.headers["content-length"] ?? "", 10);
  if (Number.isFinite(declaredLength) && declaredLength > maxBytes) {
    return Effect.succeed({ kind: "too-large" });
  }

  return request.stream.pipe(
    Stream.runFoldEffect(
      () => ({ chunks: [] as Buffer[], totalBytes: 0 }),
      (state, chunk) => {
        const totalBytes = state.totalBytes + chunk.byteLength;
        if (totalBytes > maxBytes) {
          return Effect.fail(BODY_TOO_LARGE);
        }
        state.chunks.push(Buffer.from(chunk));
        return Effect.succeed({ chunks: state.chunks, totalBytes });
      },
    ),
    Effect.flatMap(({ chunks, totalBytes }) =>
      Effect.try({
        try: () => ({
          kind: "ok" as const,
          body: JSON.parse(Buffer.concat(chunks, totalBytes).toString("utf8")) as unknown,
        }),
        catch: () => new Error("Invalid JSON body."),
      }),
    ),
    Effect.catch((error) =>
      Effect.succeed<McpBodyReadResult>(
        error === BODY_TOO_LARGE ? { kind: "too-large" } : { kind: "invalid" },
      ),
    ),
  );
}
