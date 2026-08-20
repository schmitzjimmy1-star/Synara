# OpenRouter through Codex

This build keeps one agent runtime: Codex CLI. OpenRouter is configured as a
Codex model provider, so sessions retain Codex tools, MCP servers, approvals,
sandboxing, persistence, and skills.

## Configure the profile

1. Copy `docs/openrouter.config.toml.example` to
   `~/.codex/openrouter.config.toml` (or `$CODEX_HOME/openrouter.config.toml`).
2. Run Codex directly with `codex --profile openrouter` when you want the same
   route outside Synara.
3. Make `OPENROUTER_API_KEY` available to the Synara desktop process, or use
   Codex command-backed auth to read it from your OS credential store. Do not
   put the key itself in the profile, Synara settings, source control, or logs.
4. In Synara Settings, leave **CODEX_HOME path** blank to share `~/.codex`, and
   set **Codex profile** to `openrouter`. Synara layers that profile into a
   private runtime overlay without rewriting your source TOML.
5. To add a model, first confirm the profile/provider accepts its exact
   OpenRouter `provider/model` slug. Then add the same slug to **Models →
   Composer model allowlist**. Synara passes it to Codex unchanged.

The CLI profile command is:

```sh
codex --profile openrouter
```

## Runtime ownership

- Codex owns MCP servers, plugins, skills, and agent tools. Synara does not
  inject an MCP or second agent control plane into provider sessions.
- The composer says Codex because Codex is the runtime. OpenRouter is the
  selected Codex model host, not a second Synara provider.
- PDF preview remains a local Synara web feature and does not depend on the
  model provider.
- OpenRouter model support varies. Choose a model with tool calling if you want
  Codex MCP or computer-use work.

## Current limitation

OpenRouter's Responses API is currently beta and stateless. Long tool-heavy
turns may replay more context than a stateful provider and therefore cost more.
Use account-side spending limits, and validate a new model with a deliberately
small task before trusting it with a large browser workflow.
