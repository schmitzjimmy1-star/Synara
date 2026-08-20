# Synara

Synara is a local-first desktop workspace for the Codex CLI.

It wraps your existing Codex runtime with tasks, terminals, manual browser and PDF previews, diffs,
Git worktrees, and pull-request delivery. Codex remains responsible for authentication, models,
tools, MCP servers, skills, approvals, sandboxing, and session execution.

![Synara workspace with agent task, terminal, and project navigation](assets/prod/synara-hero.jpeg)

## What it does

- **Codex-native runtime** — Synara launches the official Codex app-server instead of duplicating its agent runtime.
- **Parallel agents** — run tasks in isolated Git worktrees with their own branches so concurrent agents stay out of each other's way. Watch native subagents and workflows with live phases and pause/stop controls.
- **One working surface** — keep split chats, real terminals, browser previews and verification, files, diffs, and Git tools beside the conversation.
- **OpenRouter profiles** — route Codex through OpenRouter while keeping the same Codex-owned MCPs, skills, and approvals.
- **Plan and Debug modes** — the agent can propose before executing and pause to ask questions, or run any provider through an evidence-first debug loop without changing runtime permissions.
- **Persistent thread goals** — attach an explicit multi-turn objective with pause/resume, achievement history, and bounded autonomous continuation.
- **Review and delivery** — inspect diffs, run browser verification, commit, push, open pull requests, and use the pull-request workspace to review, comment, and merge without leaving the app.
- **Local-first by design** — chats, projects, and history stay on your machine. Coding-agent traffic goes directly to the provider you pick rather than through a Synara model service.

## Runtime ownership

Synara connects only to your installed Codex CLI. The composer labels the runtime **Codex** even
when the selected Codex profile routes inference through OpenRouter. See
[OpenRouter through Codex](docs/OPENROUTER.md) for setup and model allowlisting.

## Install

Install the [desktop app from the Releases page](https://github.com/Emanuele-web04/synara/releases),
or download it from [trysynara.com](https://www.trysynara.com/).

Synara does not include a model subscription. Install and authenticate the Codex CLI before
starting your first task. Authentication, API keys, model access, and usage limits remain with
Codex and the model host configured in Codex.

You can also run Synara locally from source while the project is still early:

```sh
bun install
bun run dev
```

## Documentation

The full product documentation lives at [trysynara.com/docs](https://www.trysynara.com/docs).
A few focused guides are also kept in this repository:

- [Quickstart](docs/quickstart.md) — from installation to your first reviewed change in about five minutes.
- [Core concepts](docs/core-concepts.md) — projects, tasks, environments, provider sessions, and Git ownership.
- [Runtime ownership](docs/providers.md) — what Synara manages and what remains Codex-owned.

## Privacy

Synara runs as the workspace layer on your machine. There is no Synara cloud holding your
repositories, chats, or project history.

The provider you choose still receives the prompts, file snippets, diffs, terminal output, or tool
results needed for a session, but that traffic goes to the provider you picked rather than through a
separate Synara-hosted workspace.

## Status

Synara is still very early. Expect bugs, rough edges, and fast-moving internals.

Focused issues and PRs are welcome, especially bug fixes, reliability fixes, and small maintenance
improvements.

## Contributing

Read [CONTRIBUTING.md](./CONTRIBUTING.md) before opening an issue or PR.

Need support? [Open a GitHub issue](https://github.com/Emanuele-web04/synara/issues).

## Origins

Synara began as a clone of [T3Code](https://github.com/pingdotgg/t3code), but it has since become a substantially different product with its own branding, packaging, release system, provider orchestration, desktop app behavior, and product direction.
