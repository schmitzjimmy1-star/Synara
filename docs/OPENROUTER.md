# OpenRouter through Codex

This build keeps one agent runtime: Codex CLI. OpenRouter is configured as a
Codex model provider, so sessions retain Codex tools, MCP servers, approvals,
sandboxing, persistence, and Synara's browser bridge.

## Configure the profile

1. For normal CLI use, copy `docs/openrouter.config.toml.example` to
   `$CODEX_HOME/openrouter.config.toml` and run Codex with
   `codex --profile openrouter`.
2. For Synara, create a dedicated Codex home such as
   `~/.codex-openrouter/config.toml` from the same template. Codex currently
   rejects `--profile` for `app-server`, so Synara must point `CODEX_HOME path`
   at that dedicated directory instead.
3. Make `OPENROUTER_API_KEY` available to the Synara desktop process, or use
   Codex command-backed auth to read it from your OS credential store. Do not
   put the key itself in the profile, Synara settings, source control, or logs.
4. In Synara Settings, set **CODEX_HOME path** to the dedicated directory.
5. Add the exact OpenRouter model slugs you intend to use under Codex custom
   models. Synara will pass the selected slug to Codex unchanged.

The CLI profile command is:

```sh
codex --profile openrouter
```

## Preserved features

- MCP injection and Synara's browser automation remain enabled because the
  runtime is still Codex app-server.
- PDF preview remains a local Synara web feature and does not depend on the
  model provider.
- OpenRouter model support varies. Choose a model with tool calling if you want
  MCP/browser work.

## Current limitation

OpenRouter's Responses API is currently beta and stateless. Long tool-heavy
turns may replay more context than a stateful provider and therefore cost more.
Use account-side spending limits, and validate a new model with a deliberately
small task before trusting it with a large browser workflow.
