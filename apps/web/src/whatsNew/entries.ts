// FILE: whatsNew/entries.ts
// Purpose: Small fork-specific release history used by the update dialog and Settings.

import type { WhatsNewEntry } from "./logic";

export const WHATS_NEW_ENTRIES: readonly WhatsNewEntry[] = [
  {
    version: "0.7.2",
    date: "Aug 20",
    features: [
      {
        id: "codex-openrouter-runtime",
        title: "Codex runtime with OpenRouter models",
        description:
          "Synara now launches Codex through a dedicated OpenRouter configuration and keeps model discovery aligned with the runtime home.",
        details:
          "Model discovery follows pagination, preserves configured OpenRouter slugs, and keeps Git writing on the same Codex runtime.",
      },
      {
        id: "browser-pdf-mcp-core",
        title: "Browser, PDF, and MCP surfaces preserved",
        description:
          "The lean fork keeps browser automation, workspace PDF preview, and external MCP integrations while retired provider surfaces are removed.",
      },
    ],
  },
];
