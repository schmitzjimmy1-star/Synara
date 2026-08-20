// FILE: AutomationCreatedCard.tsx
// Purpose: Transcript card shown when an automation is created from a thread. Replaces the
//          plain "Created automation: …" tool-call line with a glanceable box that mirrors
//          the automations view: clock glyph, automation name, cadence, and an Open action.
// Layer: Chat transcript UI

import { ClockIcon } from "~/lib/icons";

export function AutomationCreatedCard({
  name,
  cadenceLabel,
  proposalState,
  textFontSizePx,
  metaFontSizePx,
}: {
  readonly automationId: string;
  readonly name: string;
  readonly cadenceLabel: string;
  readonly proposalState?: "pending" | "accepted" | "dismissed";
  readonly textFontSizePx?: number;
  readonly metaFontSizePx?: number;
  readonly onOpen?: () => void;
}) {
  return (
    <div className="flex items-center gap-3 rounded-xl border border-[color:var(--color-border-light)] bg-[var(--color-background-elevated-primary)] px-3 py-2.5">
      <span className="flex size-11 shrink-0 items-center justify-center rounded-lg border border-[color:var(--color-border-light)] bg-[var(--color-background-elevated-secondary)] text-[var(--color-text-foreground)]">
        <ClockIcon className="size-5" aria-hidden />
      </span>
      <div className="min-w-0 flex-1">
        <p
          className="truncate font-medium text-[var(--color-text-foreground)]"
          style={textFontSizePx ? { fontSize: `${textFontSizePx}px` } : undefined}
          title={name}
        >
          {name}
        </p>
        {cadenceLabel || proposalState ? (
          <p
            className="truncate text-[var(--color-text-foreground-secondary)]"
            style={metaFontSizePx ? { fontSize: `${metaFontSizePx}px` } : undefined}
          >
            {proposalState === "pending" ? "Retired suggestion · " : ""}
            {cadenceLabel}
            {proposalState === "accepted" ? " · Previously accepted" : ""}
            {proposalState === "dismissed" ? " · Dismissed" : ""}
          </p>
        ) : null}
      </div>
    </div>
  );
}
