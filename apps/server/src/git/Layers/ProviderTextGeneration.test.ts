import { Effect, Layer } from "effect";
import { describe, expect, it, vi } from "vitest";

import {
  CodexTextGeneration,
  type TextGenerationShape,
  TextGeneration,
} from "../Services/TextGeneration.ts";
import { ProviderTextGenerationLive } from "./ProviderTextGeneration.ts";

function makeTestLayer() {
  const generateDiffSummary = vi.fn<TextGenerationShape["generateDiffSummary"]>(() =>
    Effect.succeed({ summary: "codex summary" }),
  );
  const service = {
    generateCommitMessage: () => Effect.succeed({ subject: "codex commit", body: "" }),
    generatePrContent: () => Effect.succeed({ title: "codex pr", body: "" }),
    generateDiffSummary,
    generateBranchName: () => Effect.succeed({ branch: "codex-branch" }),
    generateThreadTitle: () => Effect.succeed({ title: "codex title" }),
    generateThreadRecap: () => Effect.succeed({ recap: "codex recap" }),
    generateAutomationIntent: () =>
      Effect.succeed({
        isAutomation: false,
        confidence: 1,
        language: null,
        name: null,
        taskPrompt: null,
        schedule: null,
        mode: null,
        missingFields: [],
        needsConfirmation: false,
        reason: null,
      }),
    evaluateAutomationCompletion: () =>
      Effect.succeed({ stopMatched: false, confidence: 1, reason: "codex completion" }),
  } satisfies TextGenerationShape;
  return {
    generateDiffSummary,
    layer: ProviderTextGenerationLive.pipe(
      Layer.provide(Layer.succeed(CodexTextGeneration, service)),
    ),
  };
}

describe("ProviderTextGenerationLive", () => {
  it("routes Git writing through Codex even when legacy provider data is supplied", async () => {
    const { layer, generateDiffSummary } = makeTestLayer();
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const textGeneration = yield* TextGeneration;
        return yield* textGeneration.generateDiffSummary({
          cwd: "/repo",
          patch: "diff --git a/file.ts b/file.ts",
          modelSelection: { provider: "opencode", model: "openai/gpt-5" },
        });
      }).pipe(Effect.provide(layer)),
    );

    expect(result.summary).toBe("codex summary");
    expect(generateDiffSummary).toHaveBeenCalledTimes(1);
  });
});
