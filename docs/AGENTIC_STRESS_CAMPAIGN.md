# Synara Agentic Stress Campaign

This is a supervised reliability campaign for the Codex-first Synara desktop app. It is not a request to consume the entire allowance. Run the smoke tranche first, stop on the first repeated infrastructure defect, and only promote a prompt after its smaller predecessor produces a clean receipt.

## Guardrails

- Planned aggregate ceiling: **9,400,000 tokens**. Never exceed **10,000,000 tokens** across the campaign.
- Do not use Haiku. Use only models currently offered by Synara's OpenRouter-routed Codex catalog.
- The named budget is an administrative ceiling, not a claim that Synara can enforce a per-turn token cap. Record actual OpenRouter usage after every run.
- One prompt per fresh task. Do not let one failed task contaminate the next task's state.
- Default to read-only analysis. A prompt may create a report under `/tmp`, but it must not edit the repository, commit, push, install software, or change configuration.
- Stop the campaign if the same transport/session defect occurs twice, if model routing differs from the selected composer model, if a task attempts to expose credentials, or if cumulative usage reaches 90% of the ceiling.
- A clean run needs: selected model receipt, Codex session start, tool/subagent transcript, final answer, no duplicate task, no stuck spinner, and a usable task after restart/reopen.

## Campaign ledger

| ID  | Model                             | Ceiling | Purpose                                   |
| --- | --------------------------------- | ------: | ----------------------------------------- |
| A1  | `openai/gpt-5.6-sol`              | 650,000 | Architecture map and ownership boundaries |
| A2  | `anthropic/claude-sonnet-5`       | 700,000 | User-facing dock and failure UX review    |
| A3  | `deepseek/deepseek-v4-pro`        | 900,000 | Long-horizon reliability audit            |
| A4  | `qwen/qwen3.8-max`                | 550,000 | Independent protocol/state-machine review |
| A5  | `deepseek/deepseek-v4-flash-0731` | 700,000 | High-volume repository inventory          |
| A6  | `openai/gpt-5.6-sol`              | 850,000 | Multi-agent Terminal investigation        |
| A7  | `anthropic/claude-sonnet-5`       | 650,000 | Side-chat product and lifecycle review    |
| A8  | `deepseek/deepseek-v4-pro`        | 800,000 | Reconnect, retry, and ambiguity analysis  |
| A9  | `qwen/qwen3.8-max`                | 650,000 | MCP/tool ownership audit                  |
| A10 | `openai/gpt-5.6-sol`              | 900,000 | Test-gap and fault-injection design       |
| A11 | `anthropic/claude-sonnet-5`       | 750,000 | Browser/Files/Review parity critique      |
| A12 | `deepseek/deepseek-v4-flash-0731` | 600,000 | Dead-code and dependency census           |
| A13 | `openai/gpt-5.6-sol`              | 700,000 | Cross-run skeptical synthesis             |

**Total planned ceiling: 9,400,000 tokens.**

## Smoke tranche

Run A1, A6, and A7 first, but initially stop each after one bounded evidence pass. Their combined campaign ceiling is 2,150,000 tokens; the supervisor should halt much earlier if the app exposes routing, subagent, terminal, or side-chat defects.

## Prompts

### A1 — Codex ownership and architecture map

> Work read-only in the current Synara repository. This is a long-horizon architecture investigation, not an implementation task. Inspect the repository instructions first. Delegate three independent, bounded subagents if native subagents are available: one for the Codex app-server/session path, one for the React/Electron desktop path, and one for persistence/reconnect behavior. If subagents are unavailable, state that explicitly and perform the three passes yourself. Trace one composer send from UI selection through model routing, Codex app-server, tools, events, persistence, and final rendering. Identify every place where Synara still duplicates ownership that should belong to Codex. Validate every material claim against current files and cite exact paths and line numbers. Do not edit, install, commit, push, or reveal secrets. Return: an ownership diagram in prose, P0-P3 findings, contradictions between code and product copy, missing acceptance tests, and the next three smallest coherent repair slices.

### A2 — Dock UX under partial capability

> Review the current Synara right dock as a skeptical desktop-product engineer. Work read-only. Inspect Review, Terminal, Browser, Files/PDF, and Side chat from launcher metadata through rendering and error states. Pay special attention to new local drafts, server-backed threads, missing workspace roots, clean/non-Git folders, restored panes, collapsed panes, and offline/reconnecting states. Use two subagents if available: one for interaction/accessibility and one for lifecycle/state. Do not infer capability from a visible button; prove it from code. Return a capability matrix, every lying or ambiguous affordance, exact code evidence, and a minimal design in which stable launchers remain predictable without opening dead surfaces.

### A3 — Long-horizon runtime reliability audit

> Perform a deep read-only reliability audit of Synara's Codex session lifecycle. Split the work among at least three subagents if supported: session startup/model discovery, turn dispatch/stream reconciliation, and restart/resume/cleanup. Trace normal, slow, rejected, timed-out, duplicated, and ambiguously accepted requests. Look specifically for mutable shared configuration, lost acknowledgements, destructive cleanup after an accepted turn, duplicate resend invitations, orphaned app-server processes, and stale model catalogs. Run only focused non-mutating checks. Return a state-transition narrative, validated failure modes ranked by severity, and testable invariants. No edits or configuration changes.

### A4 — Independent protocol/state-machine review

> Treat the current Synara source as an unfamiliar distributed system. Work read-only and independently reconstruct its WebSocket, Codex JSON-RPC, orchestration-event, and local-draft state machines. Do not trust comments without matching runtime evidence. Identify transitions that are missing, duplicated, non-idempotent, or represented differently in server and web code. If subagents exist, assign one to contracts and one to implementation, then reconcile their disagreements. Return exact file/line evidence, counterexample event sequences, and a compact set of properties suitable for property-based tests.

### A5 — High-volume repository inventory

> Produce a read-only inventory of live versus compatibility-only versus dead Synara code after the Codex-first refactor. Use subagents by package boundary if possible. Start from production entry points and build an import/call graph; do not classify code as dead from text search alone. Preserve migrations and legacy decoders unless proven safe to remove. Quantify source and packaged dependency weight where evidence is cheap. Return a deletion ledger with confidence, prerequisites, compatibility hazards, and focused verification for each proposed deletion. Do not edit or delete anything.

### A6 — Multi-agent Terminal investigation

> Diagnose the Synara right-dock Terminal end to end, read-only. Reproduce conceptually from launcher click to pane activation, cwd resolution, terminal state creation, xterm attachment, WebSocket open, PTY spawn, resize, input, exit, and cleanup. Delegate separate subagents to web lifecycle, server PTY/runtime, and failure UX if available. Test these contexts in code: project-backed new draft, orphan draft, server-backed thread, worktree thread, missing cwd, restored terminal, tab switch, dock collapse, backend restart, and terminal exit. Find any state where chrome opens but no terminal runtime can attach. Return exact root causes, minimal fixes, focused tests, and installed-app acceptance steps. Do not edit or run arbitrary shell commands through the product terminal.

### A7 — Side-chat lifecycle investigation

> Diagnose Synara Side chat end to end, read-only. Trace the stable dock launcher, creator registry, eligibility checks, local-draft promotion, server thread creation/forking, model inheritance, embedded ChatView, retries, pane retention, title updates, close/delete behavior, and restart restoration. Use subagents for creation and rendering if supported. Explicitly test the difference between a brand-new draft and a server-backed main thread. Find every state where Side chat is advertised but cannot start, or where failure can duplicate/delete a valid task. Return exact code evidence, a capability policy, minimal fixes, and focused acceptance cases.

### A8 — Reconnect and ambiguous-success adversary

> Work read-only as an adversarial distributed-systems reviewer. Construct at least twelve failure timelines spanning disconnect before acknowledgement, disconnect after server acceptance, reconnect during streaming, renderer reload, backend restart, delayed snapshot, duplicate domain event, missing final event, attachment cleanup, worktree cleanup, and side-chat creation. Assign independent subagents to attack and defend the current design if available. For each timeline, state whether the user sees loss, duplication, stale UI, or safe recovery and prove it from current code. Return P0-P3 defects and exactly which destructive actions must be delayed behind authoritative receipts.

### A9 — MCP and tool ownership audit

> Audit current Synara/Codex tool ownership read-only. Trace how the selected Codex home/profile exposes MCP servers, skills, plugins, Computer Use, and approvals to app-server sessions. Identify Synara-owned catalogs, registries, prompts, RPCs, or UI that can advertise tools Codex will not actually receive. Confirm that no removed Synara automation/browser/device tool is resurrected through stale overlay configuration. If subagents are available, compare runtime wiring to UI claims independently. Return an ownership table, stale seams, credential-boundary risks, and acceptance probes that never print secret values.

### A10 — Fault-injection and test-gap design

> Design a rigorous, read-only verification program for Synara's current architecture. Inspect existing unit, integration, build, smoke, and installed-app tests. Use subagents for server graph, web state, and desktop packaging. Identify why full-layer missing services, empty environment variables, blank terminal runtimes, stale packaged assets, overlay races, and ambiguous sends could pass existing gates. Return a prioritized suite of deterministic fakes, failure injection points, full-graph smoke tests, and installed-app receipts. Include the smallest test that would have caught each known class without creating a slow flaky wall.

### A11 — Codex-like workspace parity critique

> Review Synara's right-side workspace against the interaction qualities of a mature Codex desktop surface without copying proprietary implementation. Work read-only. Inspect shared shell, pane sizing, tabs, keyboard access, Review, Terminal, Browser, Files/PDF, and Side chat. Delegate geometry/performance and accessibility/product-copy passes if subagents exist. Preserve existing Browser and PDF capabilities. Return a parity matrix, measurable layout targets, state-specific empty/error/loading designs, performance traps, and an implementation sequence that reuses shared components instead of forking five mini-apps.

### A12 — Dead code and dependency census

> Starting from production desktop/server/web entry points, conduct a read-only dead-code and dependency census after Synara became Codex-first. Use package-scoped subagents if available. Verify reachability through static imports, dynamic imports, generated routes, package scripts, release staging, and compatibility decoders. Quantify confident removable source and artifact weight. Flag half-prunes where UI/runtime/contracts/package manifests disagree. Return safe-now, coordinated-later, and must-keep lists with evidence. Do not modify manifests or lockfiles.

### A13 — Skeptical cross-run synthesis

> You are the final skeptical reviewer. Read the saved outputs from A1-A12 only if they are present; otherwise state which are missing. Do not assume consensus means correctness. Build a claim ledger, re-open source for every proposed P0/P1, discard unsupported or stale claims, identify contradictions between reviewers, and merge only validated findings. Use one adversarial subagent to try to falsify the top recommendations if available. Return: confirmed defects, rejected claims, unresolved experiments, a dependency-ordered repair roadmap, exact acceptance gates, and a cumulative token/cost receipt. Do not edit code.

## Supervision receipt

For every run record:

1. Timestamp, task ID, selected composer label, requested slug, and effective runtime slug.
2. Codex session/process identity and whether a new or resumed session was used.
3. Prompt ID, administrative ceiling, actual input/output/total tokens, and OpenRouter cost.
4. Subagents requested, subagents actually created, their completion/failure states, and whether their findings appeared in the final synthesis.
5. Files/tools accessed and any denied, missing, malformed, or duplicated calls.
6. Disconnects, retries, UI stalls, duplicate tasks, blank surfaces, or misleading success/failure copy.
7. Final disposition: clean, product defect, model limitation, routing defect, infrastructure defect, or inconclusive.

Promote to the next tranche only after the current tranche has clean receipts or a documented product fix with installed-app acceptance.
