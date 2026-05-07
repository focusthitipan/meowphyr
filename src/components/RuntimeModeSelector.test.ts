import { describe, expect, it } from "vitest";
import { shouldShowCloudSandboxOption } from "./RuntimeModeSelector";

describe("shouldShowCloudSandboxOption", () => {
  it("hides cloud sandbox when the experiment is off and cloud is not active", () => {
    expect(
      shouldShowCloudSandboxOption({
        runtimeMode: "host",
        cloudSandboxExperimentEnabled: false,
      }),
    ).toBe(false);
  });

  it("hides cloud sandbox even when the experiment is enabled (requires Meowphyr server)", () => {
    expect(
      shouldShowCloudSandboxOption({
        runtimeMode: "host",
        cloudSandboxExperimentEnabled: true,
      }),
    ).toBe(false);
  });

  it("hides cloud sandbox even when cloud mode is already active", () => {
    expect(
      shouldShowCloudSandboxOption({
        runtimeMode: "cloud",
        cloudSandboxExperimentEnabled: false,
      }),
    ).toBe(false);
  });
});
