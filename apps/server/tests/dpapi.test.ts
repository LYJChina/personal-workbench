import { access, lstat, mkdir, mkdtemp, open, readFile, readdir, realpath, rm, writeFile } from "node:fs/promises";
import { constants } from "node:fs";
import { execFile } from "node:child_process";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { promisify } from "node:util";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { WindowsDpapiSecretStore } from "../src/platform/legacy-windows-dpapi";

const runWindowsIntegration = process.platform === "win32"
  && (process.env.GITHUB_ACTIONS !== "true" || process.env.LYJ_WORKBENCH_RUN_DPAPI_INTEGRATION === "1");
const describeOnWindows = runWindowsIntegration ? describe : describe.skip;
const execFileAsync = promisify(execFile);

describe("DPAPI platform boundary", () => {
  it("short-circuits injected Darwin reads before filesystem or process collaborators", async () => {
    const lstat = vi.fn();
    const open = vi.fn();
    const runPowerShell = vi.fn();
    const store = new WindowsDpapiSecretStore("/unused/secrets", {
      platform: "darwin",
      fileSystem: { lstat, realpath: vi.fn(), open },
      runPowerShell
    });

    await expect(store.readSecret("dpapi-test-secret")).rejects.toThrow("Windows DPAPI is available only on Windows");
    expect(lstat).not.toHaveBeenCalled();
    expect(open).not.toHaveBeenCalled();
    expect(runPowerShell).not.toHaveBeenCalled();
  });
});

async function runAclScript(script: string, target: string): Promise<string> {
  const encoded = Buffer.from(script, "utf16le").toString("base64");
  const { stdout } = await execFileAsync("powershell.exe", ["-NoProfile", "-NonInteractive", "-EncodedCommand", encoded], {
    env: { ...process.env, LYJ_WORKBENCH_ACL_TEST_PATH: target },
    windowsHide: true
  });
  return stdout.trim();
}

async function grantBuiltInUsersRead(target: string): Promise<void> {
  await runAclScript(String.raw`
$file = New-Object System.IO.FileInfo($env:LYJ_WORKBENCH_ACL_TEST_PATH)
$acl = $file.GetAccessControl()
$users = New-Object System.Security.Principal.SecurityIdentifier('S-1-5-32-545')
$rule = New-Object System.Security.AccessControl.FileSystemAccessRule($users, 'Read', 'Allow')
$acl.AddAccessRule($rule)
$file.SetAccessControl($acl)
`, target);
}

async function accessIdentities(target: string): Promise<string[]> {
  const identities = await runAclScript(String.raw`
$file = New-Object System.IO.FileInfo($env:LYJ_WORKBENCH_ACL_TEST_PATH)
$acl = $file.GetAccessControl([System.Security.AccessControl.AccessControlSections]::Access)
$identities = $acl.GetAccessRules($true, $true, [System.Security.Principal.SecurityIdentifier]) | ForEach-Object { $_.IdentityReference.Value }
[Console]::Out.Write(($identities -join ','))
`, target);
  return [...new Set(identities.split(",").filter(Boolean))];
}

async function currentUserSid(target: string): Promise<string> {
  return runAclScript("[Console]::Out.Write([System.Security.Principal.WindowsIdentity]::GetCurrent().User.Value)", target);
}

describeOnWindows("Windows DPAPI secret store", { timeout: 20_000 }, () => {
  let tempDir: string;
  const secretName = "dpapi-test-secret";

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "lyj-workbench-dpapi-"));
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  it("round trips a CurrentUser-protected disposable secret and removes its blob during cleanup", async () => {
    const plaintext = "一次性 DPAPI secret";
    const secretsDir = join(tempDir, "secrets");
    const blobPath = join(secretsDir, `${secretName}.bin`);
    const store = new WindowsDpapiSecretStore(secretsDir);

    await store.protectSecret(secretName, plaintext);

    expect(await store.readSecret(secretName)).toBe(plaintext);
    expect((await readFile(blobPath)).includes(Buffer.from(plaintext))).toBe(false);
    await rm(blobPath);
    await expect(access(blobPath, constants.F_OK)).rejects.toThrow();
  });

  it("rejects secret names outside the fixed allowlist", async () => {
    const store = new WindowsDpapiSecretStore(join(tempDir, "secrets"));
    await expect(store.protectSecret("../escape", "secret")).rejects.toThrow("Unsupported secret name");
    await expect(store.readSecret("unknown-secret")).rejects.toThrow("Unsupported secret name");
  });

  it("rejects oversized protected blobs before PowerShell", async () => {
    const secretsDir = join(tempDir, "secrets");
    await mkdir(secretsDir);
    const blobPath = join(secretsDir, `${secretName}.bin`);
    await writeFile(blobPath, Buffer.alloc(1024 * 1024 + 1, 1));
    const handle = await open(blobPath, "r");
    const read = vi.spyOn(handle, "read");
    const readFile = vi.spyOn(handle, "readFile");
    const close = vi.spyOn(handle, "close");
    const runPowerShell = vi.fn();
    const store = new WindowsDpapiSecretStore(secretsDir, {
      platform: "win32", runPowerShell,
      fileSystem: { lstat, realpath, open: vi.fn().mockResolvedValue(handle) }
    });

    await expect(store.readSecret(secretName)).rejects.toThrow("Windows DPAPI operation failed");
    expect(read).not.toHaveBeenCalled();
    expect(readFile).not.toHaveBeenCalled();
    expect(close).toHaveBeenCalledOnce();
    expect(runPowerShell).not.toHaveBeenCalled();
  });

  it("bounds short descriptor reads when the protected blob grows concurrently", async () => {
    const secretsDir = join(tempDir, "secrets");
    await mkdir(secretsDir);
    const blobPath = join(secretsDir, `${secretName}.bin`);
    await writeFile(blobPath, "small protected fixture");
    const candidate = await lstat(blobPath);
    const read = vi.fn(async (buffer: Buffer, offset: number, length: number) => {
      const bytesRead = Math.min(length, 400_000);
      buffer.fill(1, offset, offset + bytesRead);
      return { bytesRead, buffer };
    });
    const close = vi.fn().mockResolvedValue(undefined);
    const handle = { stat: vi.fn().mockResolvedValue(candidate), read, close };
    const runPowerShell = vi.fn();
    const store = new WindowsDpapiSecretStore(secretsDir, {
      platform: "win32", runPowerShell,
      fileSystem: { lstat, realpath, open: vi.fn().mockResolvedValue(handle as never) }
    });

    await expect(store.readSecret(secretName)).rejects.toThrow("Windows DPAPI operation failed");
    expect(read).toHaveBeenCalledTimes(3);
    expect(read.mock.calls.every(([, , length]) => length <= 1024 * 1024 + 1)).toBe(true);
    expect(runPowerShell).not.toHaveBeenCalled();
    expect(close).toHaveBeenCalledOnce();
  });

  it("rejects and zeroes oversized plaintext output", async () => {
    const secretsDir = join(tempDir, "secrets");
    await mkdir(secretsDir);
    await writeFile(join(secretsDir, `${secretName}.bin`), "protected fixture");
    const plaintext = Buffer.alloc(64 * 1024 + 1, 7);
    const store = new WindowsDpapiSecretStore(secretsDir, {
      platform: "win32",
      runPowerShell: vi.fn().mockResolvedValue(plaintext)
    });

    await expect(store.readSecret(secretName)).rejects.toThrow("Windows DPAPI operation failed");
    expect(plaintext.every((byte) => byte === 0)).toBe(true);
  });

  it("rejects a secrets-root identity swap after opening the exact-name blob without invoking PowerShell", async () => {
    const secretsDir = join(tempDir, "secrets");
    await mkdir(secretsDir);
    await writeFile(join(secretsDir, `${secretName}.bin`), "protected fixture");
    let rootRealpaths = 0;
    const runPowerShell = vi.fn();
    const store = new WindowsDpapiSecretStore(secretsDir, {
      platform: "win32",
      runPowerShell,
      fileSystem: {
        open,
        lstat,
        realpath: async (path) => {
          const canonical = await realpath(path);
          if (resolve(String(path)).toLowerCase() !== resolve(secretsDir).toLowerCase() || ++rootRealpaths === 1) return canonical;
          return `${canonical}-swapped`;
        }
      }
    });

    await expect(store.readSecret(secretName)).rejects.toThrow("Windows DPAPI operation failed");
    expect(runPowerShell).not.toHaveBeenCalled();
  });

  it("ignores an ambient DPAPI failure point on the normal production path", async () => {
    const previousFailurePoint = process.env.LYJ_WORKBENCH_DPAPI_FAILURE_POINT;
    process.env.LYJ_WORKBENCH_DPAPI_FAILURE_POINT = "before_final_target_acl";

    try {
      const store = new WindowsDpapiSecretStore(join(tempDir, "secrets"));
      await store.protectSecret(secretName, "ambient environment must not inject failure");

      expect(await store.readSecret(secretName)).toBe("ambient environment must not inject failure");
    } finally {
      if (previousFailurePoint === undefined) delete process.env.LYJ_WORKBENCH_DPAPI_FAILURE_POINT;
      else process.env.LYJ_WORKBENCH_DPAPI_FAILURE_POINT = previousFailurePoint;
    }
  });

  it("restores a current-user-only ACL when replacing an existing blob", async () => {
    const blobPath = join(tempDir, "secrets", `${secretName}.bin`);
    const store = new WindowsDpapiSecretStore(join(tempDir, "secrets"));
    await store.protectSecret(secretName, "initial disposable value");
    await grantBuiltInUsersRead(blobPath);

    await store.protectSecret(secretName, "replacement disposable value");

    expect(await accessIdentities(blobPath)).toEqual([await currentUserSid(blobPath)]);
  });

  it("hardens a broadened existing blob before replacement begins", async () => {
    const secretsDir = join(tempDir, "secrets");
    const blobPath = join(secretsDir, `${secretName}.bin`);
    const store = new WindowsDpapiSecretStore(secretsDir);
    await store.protectSecret(secretName, "previous protected value");
    await grantBuiltInUsersRead(blobPath);
    const interruptedStore = new WindowsDpapiSecretStore(secretsDir, { failurePoint: "after_existing_target_hardened" });

    await expect(interruptedStore.protectSecret(secretName, "uncommitted replacement")).rejects.toThrow("Windows DPAPI operation failed");

    expect(await store.readSecret(secretName)).toBe("previous protected value");
    expect(await accessIdentities(blobPath)).toEqual([await currentUserSid(blobPath)]);
    expect(await readdir(secretsDir)).toEqual([`${secretName}.bin`]);
  });

  it("restores the previous safe blob when final ACL application fails", async () => {
    const secretsDir = join(tempDir, "secrets");
    const blobPath = join(secretsDir, `${secretName}.bin`);
    const store = new WindowsDpapiSecretStore(secretsDir);
    await store.protectSecret(secretName, "previous protected value");
    await grantBuiltInUsersRead(blobPath);
    const interruptedStore = new WindowsDpapiSecretStore(secretsDir, { failurePoint: "before_final_target_acl" });

    await expect(interruptedStore.protectSecret(secretName, "uncommitted replacement")).rejects.toThrow("Windows DPAPI operation failed");

    expect(await store.readSecret(secretName)).toBe("previous protected value");
    expect(await accessIdentities(blobPath)).toEqual([await currentUserSid(blobPath)]);
    expect(await readdir(secretsDir)).toEqual([`${secretName}.bin`]);
  });
});
