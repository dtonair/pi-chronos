import { describe, expect, it } from "vitest";
import { checkShellCommand } from "../../../src/security/shell-policy.js";
import { DEFAULT_PERMISSIONS } from "../../fixtures/database.js";

describe("shell and network policy", () => {
  it("requires exact shell authorization", () => {
    const result = checkShellCommand("echo hello", {
      ...DEFAULT_PERMISSIONS,
      shell: { allowed: true, commands: ["echo hello"] },
    });
    expect(result.ok).toBe(true);
    expect(
      checkShellCommand("echo hello && id", {
        ...DEFAULT_PERMISSIONS,
        shell: { allowed: true, commands: ["echo hello"] },
      }).ok,
    ).toBe(false);
  });

  it("denies disabled shells and network commands without destinations", () => {
    expect(
      checkShellCommand("echo hello", {
        ...DEFAULT_PERMISSIONS,
        shell: { allowed: false, commands: [] },
      }).ok,
    ).toBe(false);
    expect(
      checkShellCommand("curl example.com", {
        ...DEFAULT_PERMISSIONS,
        shell: { allowed: true, commands: ["curl example.com"] },
        network: { allowed: true, domains: ["example.com"] },
      }).ok,
    ).toBe(false);
  });

  it("denies unverifiable network commands and allows declared domains", () => {
    const base = {
      ...DEFAULT_PERMISSIONS,
      shell: { allowed: true, commands: ["curl https://api.example.com"] },
    };
    expect(checkShellCommand("curl https://api.example.com", base).ok).toBe(false);
    expect(
      checkShellCommand("curl https://api.example.com", {
        ...base,
        network: { allowed: true, domains: ["example.com"] },
      }).ok,
    ).toBe(true);
    expect(
      checkShellCommand("curl https://evil.example.net", {
        ...base,
        network: { allowed: true, domains: ["example.com"] },
      }).ok,
    ).toBe(false);
  });
});
