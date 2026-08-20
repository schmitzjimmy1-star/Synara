# Codex runtime ownership

Synara is a desktop interface around the official Codex CLI. It does not host models, implement a
second agent runtime, or inject its own MCP server.

## The ownership chain

1. Synara owns the task list, transcript presentation, terminal, Git, manual browser panel, PDF
   preview, and other workspace UI.
2. Codex owns authentication, sessions, tool execution, approvals, sandboxing, MCP servers, skills,
   plugins, model discovery, and model requests.
3. A Codex profile may select OpenAI or another model host such as OpenRouter.

That is why the composer says **Codex** even when a model slug is
`anthropic/claude-sonnet-5`: Claude is the model, OpenRouter is the host, and Codex is still the
agent runtime.

## Configure Codex

1. Install the official Codex CLI and verify it works from a fresh terminal.
2. Authenticate Codex normally. Synara shares the same `CODEX_HOME` by default.
3. Keep **CODEX_HOME path** blank unless you intentionally maintain another Codex home.
4. Set **Codex profile** when you want Synara to layer a named
   `$CODEX_HOME/<profile>.config.toml` over the base config.
5. Open the composer and confirm the expected live model catalog appears.

Synara creates a private runtime overlay so profile layering does not rewrite the source TOML.
Authentication and the rest of the Codex home remain shared.

## Add an OpenRouter model

1. Configure the `openrouter` Codex profile as described in
   [OpenRouter through Codex](OPENROUTER.md).
2. Verify the exact OpenRouter `provider/model` slug is accepted by that profile.
3. Add the same slug under **Settings → Models → Composer model allowlist**.
4. Reopen the composer. The list is the intersection of the Codex profile's usable catalog and the
   allowlist, with configured custom-provider slugs preserved when Codex does not publish metadata.

Choose models with reliable tool calling when you expect Codex to use MCPs or other tools.

## Troubleshooting

Check these boundaries in order:

1. Does `codex` run and authenticate in a fresh terminal?
2. Does the selected Codex profile work directly?
3. Is **CODEX_HOME path** blank or pointing at the intended home?
4. Is the profile name an exact filename stem using only letters, numbers, underscores, or hyphens?
5. Does the OpenRouter slug exactly match the allowlist entry?
6. Does refreshing provider status and reopening the composer update the catalog?

If Codex itself cannot list or run the model, Synara cannot repair that at the UI layer.
