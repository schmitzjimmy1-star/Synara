import { Effect, Layer } from "effect";

import {
  CodexTextGeneration,
  type TextGenerationShape,
  TextGeneration,
} from "../Services/TextGeneration.ts";

const makeProviderTextGeneration = Effect.gen(function* () {
  const codexTextGeneration = yield* CodexTextGeneration;

  return {
    generateCommitMessage: (input) => codexTextGeneration.generateCommitMessage(input),
    generatePrContent: (input) => codexTextGeneration.generatePrContent(input),
    generateDiffSummary: (input) => codexTextGeneration.generateDiffSummary(input),
    generateBranchName: (input) => codexTextGeneration.generateBranchName(input),
    generateThreadTitle: (input) => codexTextGeneration.generateThreadTitle(input),
    generateThreadRecap: (input) => codexTextGeneration.generateThreadRecap(input),
    generateAutomationIntent: (input) => codexTextGeneration.generateAutomationIntent(input),
    evaluateAutomationCompletion: (input) =>
      codexTextGeneration.evaluateAutomationCompletion(input),
  } satisfies TextGenerationShape;
});

export const ProviderTextGenerationLive = Layer.effect(TextGeneration, makeProviderTextGeneration);
