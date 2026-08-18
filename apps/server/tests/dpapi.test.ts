import { access, mkdtemp, readFile, rm } from "node:fs/promises";
import { constants } from "node:fs";
import { execFile } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { WindowsDpapiSecretStore } from "../src/platform/dpapi";

const describeOnWindows = process.platform === "win32" ? describe : describe.skip;
const execFileAsync = promisify(execFile);

async function runAclScript(script: string, target: string): Promise<string> {
  const encoded = Buffer.from(script, "utf16le").toString("base64");
  const { stdout } = await execFileAsync("powershell.exe", ["-NoProfile", "-NonInteractive", "-EncodedCommand", encoded], {
    env: { ...process.env, LYJ_WORKBENCH_ACL_TEST_PATH: target },
    windowsHide: true
  });
  return stdout.trim();
}

describeOnWindows("Windows DPAPI secret store", () => {
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

  it("restores a current-user-only ACL when replacing an existing blob", async () => {
    const blobPath = join(tempDir, "secrets", `${secretName}.bin`);
    const store = new WindowsDpapiSecretStore(join(tempDir, "secrets"));
    await store.protectSecret(secretName, "initial disposable value");
    await runAclScript(String.raw`
$file = New-Object System.IO.FileInfo($env:LYJ_WORKBENCH_ACL_TEST_PATH)
$acl = $file.GetAccessControl()
$users = New-Object System.Security.Principal.SecurityIdentifier('S-1-5-32-545')
$rule = New-Object System.Security.AccessControl.FileSystemAccessRule($users, 'Read', 'Allow')
$acl.AddAccessRule($rule)
$file.SetAccessControl($acl)
`, blobPath);

    await store.protectSecret(secretName, "replacement disposable value");

    const identities = await runAclScript(String.raw`
$file = New-Object System.IO.FileInfo($env:LYJ_WORKBENCH_ACL_TEST_PATH)
$acl = $file.GetAccessControl([System.Security.AccessControl.AccessControlSections]::Access)
$identities = $acl.GetAccessRules($true, $true, [System.Security.Principal.SecurityIdentifier]) | ForEach-Object { $_.IdentityReference.Value }
[Console]::Out.Write(($identities -join ','))
`, blobPath);
    const currentSid = await runAclScript("[Console]::Out.Write([System.Security.Principal.WindowsIdentity]::GetCurrent().User.Value)", blobPath);
    expect([...new Set(identities.split(",").filter(Boolean))]).toEqual([currentSid]);
  });
});
