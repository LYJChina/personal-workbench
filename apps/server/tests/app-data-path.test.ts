import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { resolveAppPaths } from "../src/config/paths";
import { resolveDefaultDataDir } from "../src/platform/app-data-path";

describe("default application data directory", () => {
  it("prefers LOCALAPPDATA on Windows", () => {
    expect(resolveDefaultDataDir({
      platform: "win32",
      environment: {
        LOCALAPPDATA: "C:\\Users\\me\\AppData\\Local",
        APPDATA: "C:\\Users\\me\\AppData\\Roaming"
      },
      homeDir: "C:\\Users\\me"
    })).toBe("C:\\Users\\me\\AppData\\Local\\LYJWorkBench");
  });

  it("falls back to APPDATA on Windows", () => {
    expect(resolveDefaultDataDir({
      platform: "win32",
      environment: { APPDATA: "C:\\Users\\me\\AppData\\Roaming" },
      homeDir: "C:\\Users\\me"
    })).toBe("C:\\Users\\me\\AppData\\Roaming\\LYJWorkBench");
  });

  it("falls back when LOCALAPPDATA is blank", () => {
    expect(resolveDefaultDataDir({
      platform: "win32",
      environment: {
        LOCALAPPDATA: "   ",
        APPDATA: "C:\\Users\\me\\AppData\\Roaming"
      },
      homeDir: "C:\\Users\\me"
    })).toBe("C:\\Users\\me\\AppData\\Roaming\\LYJWorkBench");
  });

  it.each([
    { LOCALAPPDATA: "", APPDATA: "" },
    { LOCALAPPDATA: "   ", APPDATA: "\t" }
  ])("rejects missing or blank Windows roots", (environment) => {
    expect(() => resolveDefaultDataDir({
      platform: "win32",
      environment,
      homeDir: "C:\\Users\\me"
    })).toThrowError("Windows application data directory is unavailable");
  });

  it("uses the macOS application support directory and ignores Windows variables", () => {
    expect(resolveDefaultDataDir({
      platform: "darwin",
      environment: {
        LOCALAPPDATA: "C:\\should-not-be-used",
        APPDATA: "C:\\also-ignored"
      },
      homeDir: "/Users/me"
    })).toBe("/Users/me/Library/Application Support/LYJWorkBench");
  });

  it.each(["", "   ", "\t"])("rejects a missing or blank macOS home directory", (homeDir) => {
    expect(() => resolveDefaultDataDir({
      platform: "darwin",
      environment: {},
      homeDir
    })).toThrowError("macOS home directory is unavailable");
  });

  it("rejects unsupported platforms with a stable error", () => {
    expect(() => resolveDefaultDataDir({
      platform: "linux",
      environment: {},
      homeDir: "/home/me"
    })).toThrowError("Unsupported platform: linux");
  });
});

describe("application paths", () => {
  it("keeps an explicit dataDir authoritative", () => {
    const dataDir = join("some", "explicit", "data-directory");

    expect(resolveAppPaths({ dataDir })).toEqual({
      dataDir,
      databasePath: join(dataDir, "workbench.sqlite"),
      uploadsDir: join(dataDir, "uploads"),
      secretsDir: join(dataDir, "secrets")
    });
  });
});
