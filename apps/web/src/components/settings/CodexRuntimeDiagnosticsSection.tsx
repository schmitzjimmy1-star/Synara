// FILE: CodexRuntimeDiagnosticsSection.tsx
// Purpose: Show the server's secret-safe evidence for the Codex runtime Synara delegates to.
// Layer: Settings UI component

import { useQuery } from "@tanstack/react-query";

import { Loader2Icon } from "~/lib/icons";
import { serverDiagnosticsQueryOptions } from "~/lib/serverReactQuery";

import { Button } from "../ui/button";
import {
  SettingsCard,
  SettingsEmptyState,
  SettingsListRow,
  SettingsSectionShell,
} from "./SettingsPanelPrimitives";

function routeLabel(route: {
  readonly provider: string | null;
  readonly kind: "openai" | "custom-responses" | "custom-incompatible" | "unknown";
}): string {
  if (route.kind === "openai") return "OpenAI through Codex";
  if (route.kind === "custom-responses")
    return `${route.provider ?? "Custom provider"} · Responses API`;
  return route.provider ?? "Route unavailable";
}

function sessionDescription(input: {
  readonly totalCount: number;
  readonly runningCount: number;
  readonly models: ReadonlyArray<{ readonly model: string; readonly count: number }>;
}): string {
  if (input.totalCount === 0) return "No Codex app-server sessions are active.";
  const models = input.models.map(({ model, count }) => `${model} × ${count}`).join(", ");
  return `${input.runningCount} running of ${input.totalCount} active${models ? ` · ${models}` : ""}`;
}

export function CodexRuntimeDiagnosticsSection({ active }: { readonly active: boolean }) {
  const diagnosticsQuery = useQuery(serverDiagnosticsQueryOptions(active));
  const diagnostics = diagnosticsQuery.data?.codex;

  return (
    <SettingsSectionShell
      title="Runtime diagnostics"
      action={
        <Button
          type="button"
          variant="ghost"
          size="sm"
          disabled={diagnosticsQuery.isFetching}
          onClick={() => void diagnosticsQuery.refetch()}
        >
          {diagnosticsQuery.isFetching ? <Loader2Icon className="animate-spin" /> : null}
          Refresh
        </Button>
      }
    >
      {diagnosticsQuery.isError ? (
        <SettingsEmptyState layout="status" tone="destructive">
          Runtime evidence could not be loaded. The Codex configuration was not changed.
        </SettingsEmptyState>
      ) : diagnostics === undefined ? (
        <SettingsEmptyState layout="status">Reading the active Codex runtime…</SettingsEmptyState>
      ) : (
        <SettingsCard>
          <SettingsListRow
            title="Codex executable"
            description={
              diagnostics.binary.resolvedPath ?? diagnostics.binary.detail ?? "Not found"
            }
            actions={
              <span className="text-[11px] text-muted-foreground">
                {diagnostics.binary.status === "ready"
                  ? diagnostics.binary.source === "official-app"
                    ? "Official app bundle"
                    : diagnostics.binary.source === "explicit"
                      ? "Explicit path"
                      : "Shell PATH"
                  : "Unavailable"}
              </span>
            }
          />
          <SettingsListRow
            title="Codex home"
            description={`${diagnostics.sourceHomePath}${diagnostics.profile ? ` · profile ${diagnostics.profile}` : " · default profile"}`}
            actions={
              diagnostics.profileConfigPresent ? null : (
                <span className="text-[11px] text-destructive">Profile missing</span>
              )
            }
          />
          <SettingsListRow
            title="Model route"
            description={
              diagnostics.route.detail ?? diagnostics.route.baseUrl ?? "Codex account routing"
            }
            actions={
              <span
                className={
                  diagnostics.route.status === "ready"
                    ? "text-[11px] text-muted-foreground"
                    : "text-[11px] text-destructive"
                }
              >
                {routeLabel(diagnostics.route)}
              </span>
            }
          />
          <SettingsListRow
            title="MCP configuration"
            description={`${diagnostics.configuredMcpServerCount} configured ${diagnostics.configuredMcpServerCount === 1 ? "server" : "servers"}. Runtime startup and tool availability remain Codex-owned.`}
            actions={<span className="text-[11px] text-muted-foreground">Codex-owned</span>}
          />
          <SettingsListRow
            title="Active sessions"
            description={sessionDescription(diagnostics.activeSessions)}
            actions={<span className="text-[11px] text-muted-foreground">app-server</span>}
          />
          <SettingsListRow
            title="Capability ownership"
            description="Codex owns execution, authentication, model routing, MCPs, skills, and plugins. Synara only presents the resulting state."
            actions={<span className="text-[11px] text-muted-foreground">Delegated</span>}
          />
        </SettingsCard>
      )}
    </SettingsSectionShell>
  );
}
