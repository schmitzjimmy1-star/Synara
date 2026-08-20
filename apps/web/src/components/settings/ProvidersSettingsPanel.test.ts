import { describe, expect, it } from "vitest";

import { type AppSettings, AppSettingsSchema } from "~/appSettings";

import {
  createProviderInstallResetPatch,
  isProviderInstallSettingsDirty,
} from "./ProvidersSettingsPanel";

const defaults = AppSettingsSchema.makeUnsafe({});

describe("isProviderInstallSettingsDirty", () => {
  it("covers every Codex configuration field", () => {
    const dirtyPatches = [
      { codexBinaryPath: "/opt/codex" },
      { codexHomePath: "/tmp/codex-home" },
    ] satisfies ReadonlyArray<Partial<AppSettings>>;

    expect(isProviderInstallSettingsDirty(defaults, defaults)).toBe(false);
    for (const patch of dirtyPatches) {
      expect(isProviderInstallSettingsDirty({ ...defaults, ...patch }, defaults)).toBe(true);
    }
  });

  it("ignores retired provider settings", () => {
    expect(
      isProviderInstallSettingsDirty({ ...defaults, kiloServerPassword: "secret" }, defaults),
    ).toBe(false);
    expect(
      isProviderInstallSettingsDirty({ ...defaults, kiloServerPasswordConfigured: true }, defaults),
    ).toBe(false);
    expect(
      isProviderInstallSettingsDirty(
        { ...defaults, openCodeServerPasswordConfigured: true },
        defaults,
      ),
    ).toBe(false);
  });
});

describe("createProviderInstallResetPatch", () => {
  it("resets every Codex configuration field", () => {
    const patch = createProviderInstallResetPatch({
      ...defaults,
      kiloServerPassword: "",
      openCodeServerPassword: "",
    });

    expect(Object.keys(patch).sort()).toEqual(
      ["codexBinaryPath", "codexHomePath"].sort(),
    );
  });
});
