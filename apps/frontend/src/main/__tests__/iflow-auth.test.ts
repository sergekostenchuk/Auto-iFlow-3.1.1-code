import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "fs";
import path from "path";
import os from "os";
import { hasIflowWebLogin } from "../iflow-auth";

vi.mock("os", async () => {
  const actual = await vi.importActual<typeof import("os")>("os");
  return {
    ...actual,
    homedir: vi.fn(() => "/mock/home"),
  };
});

describe("hasIflowWebLogin", () => {
  const originalEnv = {
    IFLOW_HOME: process.env.IFLOW_HOME,
    IFLOW_DIR: process.env.IFLOW_DIR,
    XDG_CONFIG_HOME: process.env.XDG_CONFIG_HOME,
  };
  let tempDir = "";
  let baseDir = "";

  beforeEach(() => {
    tempDir = mkdtempSync(path.join(os.tmpdir(), "iflow-auth-"));
    baseDir = path.join(tempDir, ".iflow");
    process.env.IFLOW_HOME = baseDir;
    delete process.env.IFLOW_DIR;
    delete process.env.XDG_CONFIG_HOME;
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
    process.env.IFLOW_HOME = originalEnv.IFLOW_HOME;
    process.env.IFLOW_DIR = originalEnv.IFLOW_DIR;
    process.env.XDG_CONFIG_HOME = originalEnv.XDG_CONFIG_HOME;
  });

  const writeSettings = (settings: Record<string, unknown>) => {
    mkdirSync(baseDir, { recursive: true });
    writeFileSync(
      path.join(baseDir, "settings.json"),
      JSON.stringify(settings),
    );
  };

  const writeLogLine = (line: string) => {
    const logDir = path.join(baseDir, "log");
    mkdirSync(logDir, { recursive: true });
    writeFileSync(path.join(logDir, "console-test.log"), `${line}\n`);
  };

  it("returns true when CLI settings use oauth-iflow", () => {
    writeSettings({ selectedAuthType: "oauth-iflow" });

    expect(hasIflowWebLogin()).toBe(true);
  });

  it("returns true when CLI settings use iflow with apiKey", () => {
    writeSettings({ selectedAuthType: "iflow", apiKey: "iflow-test-key" });

    expect(hasIflowWebLogin()).toBe(true);
  });

  it("returns true when logs show authenticated via iflow after reset", () => {
    const now = new Date();
    const timestamp = now.toISOString();
    writeLogLine(`[${timestamp}] [log] Authenticated via "iflow".`);

    expect(hasIflowWebLogin(now.getTime() - 1000)).toBe(true);
  });

  it("returns false when no auth markers are present", () => {
    expect(hasIflowWebLogin()).toBe(false);
  });
});
