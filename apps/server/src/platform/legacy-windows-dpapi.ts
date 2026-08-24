import { spawn } from "node:child_process";
import { lstat, open, realpath } from "node:fs/promises";
import { constants, type Stats } from "node:fs";
import { join, resolve, sep } from "node:path";
import type { SecretStore } from "./secret-store.js";

const allowedSecretNames = new Set(["deepseek-api-key", "smtp-password", "dpapi-test-secret"]);
const maxProtectedSecretBytes = 1024 * 1024;
const maxPlaintextSecretBytes = 64 * 1024;

export interface WindowsDpapiSecretStoreOptions {
  failurePoint?: "after_existing_target_hardened" | "before_final_target_acl";
  platform?: NodeJS.Platform;
  fileSystem?: DpapiFileSystem;
  runPowerShell?: typeof runPowerShell;
}

export interface DpapiFileSystem {
  lstat(path: string): Promise<Stats>;
  realpath(path: string): Promise<string>;
  open(path: string, flags: string | number): ReturnType<typeof open>;
}

const nativeFileSystem: DpapiFileSystem = { lstat, realpath, open };

const protectScript = String.raw`
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Security
$target = $env:LYJ_WORKBENCH_SECRET_PATH
$directory = [System.IO.Path]::GetDirectoryName($target)
[System.IO.Directory]::CreateDirectory($directory) | Out-Null
$sid = [System.Security.Principal.WindowsIdentity]::GetCurrent().User
function Set-CurrentUserOnlyAcl($item, $inheritanceFlags) {
  $acl = $item.GetAccessControl()
  $acl.SetAccessRuleProtection($true, $false)
  $rules = @($acl.GetAccessRules($true, $false, [System.Security.Principal.SecurityIdentifier]))
  foreach ($rule in $rules) { $acl.RemoveAccessRuleSpecific($rule) }
  $currentUserRule = New-Object System.Security.AccessControl.FileSystemAccessRule($sid, [System.Security.AccessControl.FileSystemRights]::FullControl, $inheritanceFlags, [System.Security.AccessControl.PropagationFlags]::None, [System.Security.AccessControl.AccessControlType]::Allow)
  $acl.AddAccessRule($currentUserRule)
  $item.SetAccessControl($acl)
}
function Assert-CurrentUserOnlyAcl($item) {
  $acl = $item.GetAccessControl([System.Security.AccessControl.AccessControlSections]::Access)
  if (-not $acl.AreAccessRulesProtected) { throw 'Secret ACL inheritance is enabled' }
  $rules = @($acl.GetAccessRules($true, $true, [System.Security.Principal.SecurityIdentifier]))
  if ($rules.Count -ne 1) { throw 'Secret ACL has unexpected rules' }
  $rule = $rules[0]
  if ($rule.IdentityReference.Value -ne $sid.Value -or $rule.AccessControlType -ne [System.Security.AccessControl.AccessControlType]::Allow -or ($rule.FileSystemRights -band [System.Security.AccessControl.FileSystemRights]::FullControl) -ne [System.Security.AccessControl.FileSystemRights]::FullControl) {
    throw 'Secret ACL is not current-user-only'
  }
}
$directoryInfo = New-Object System.IO.DirectoryInfo($directory)
Set-CurrentUserOnlyAcl $directoryInfo ([System.Security.AccessControl.InheritanceFlags]'ContainerInherit,ObjectInherit')
Assert-CurrentUserOnlyAcl $directoryInfo
$targetExisted = [System.IO.File]::Exists($target)
if ($targetExisted) {
  $existingTargetInfo = New-Object System.IO.FileInfo($target)
  Set-CurrentUserOnlyAcl $existingTargetInfo ([System.Security.AccessControl.InheritanceFlags]::None)
  Assert-CurrentUserOnlyAcl $existingTargetInfo
  if ($env:LYJ_WORKBENCH_DPAPI_FAILURE_POINT -eq 'after_existing_target_hardened') { throw 'Injected DPAPI failure' }
}
$inputStream = [Console]::OpenStandardInput()
$memory = New-Object System.IO.MemoryStream
$temporary = $null
$backup = $null
$replacementCompleted = $false
try {
  $inputStream.CopyTo($memory)
  $plaintext = $memory.ToArray()
  try {
    $protected = [System.Security.Cryptography.ProtectedData]::Protect($plaintext, $null, [System.Security.Cryptography.DataProtectionScope]::CurrentUser)
    $temporary = [System.IO.Path]::Combine($directory, [System.IO.Path]::GetRandomFileName())
    [System.IO.File]::WriteAllBytes($temporary, $protected)
    $fileInfo = New-Object System.IO.FileInfo($temporary)
    Set-CurrentUserOnlyAcl $fileInfo ([System.Security.AccessControl.InheritanceFlags]::None)
    Assert-CurrentUserOnlyAcl $fileInfo
    if ($targetExisted) {
      $backup = [System.IO.Path]::Combine($directory, [System.IO.Path]::GetRandomFileName())
      [System.IO.File]::Replace($temporary, $target, $backup, $true)
    } else {
      [System.IO.File]::Move($temporary, $target)
    }
    $temporary = $null
    $replacementCompleted = $true
    if ($null -ne $backup) {
      $backupInfo = New-Object System.IO.FileInfo($backup)
      Set-CurrentUserOnlyAcl $backupInfo ([System.Security.AccessControl.InheritanceFlags]::None)
      Assert-CurrentUserOnlyAcl $backupInfo
    }
    if ($env:LYJ_WORKBENCH_DPAPI_FAILURE_POINT -eq 'before_final_target_acl') { throw 'Injected DPAPI failure' }
    $targetInfo = New-Object System.IO.FileInfo($target)
    Set-CurrentUserOnlyAcl $targetInfo ([System.Security.AccessControl.InheritanceFlags]::None)
    Assert-CurrentUserOnlyAcl $targetInfo
    if ($null -ne $backup) {
      [System.IO.File]::Delete($backup)
      $backup = $null
    }
  } finally {
    if ($null -ne $plaintext) { [Array]::Clear($plaintext, 0, $plaintext.Length) }
  }
} catch {
  $originalError = $_
  if ($replacementCompleted -and $null -ne $backup -and [System.IO.File]::Exists($backup)) {
    if ([System.IO.File]::Exists($target)) { [System.IO.File]::Delete($target) }
    [System.IO.File]::Move($backup, $target)
    $backup = $null
    $restoredInfo = New-Object System.IO.FileInfo($target)
    Set-CurrentUserOnlyAcl $restoredInfo ([System.Security.AccessControl.InheritanceFlags]::None)
    Assert-CurrentUserOnlyAcl $restoredInfo
  } elseif ($replacementCompleted -and -not $targetExisted -and [System.IO.File]::Exists($target)) {
    [System.IO.File]::Delete($target)
  }
  throw $originalError
} finally {
  $memory.Dispose()
  if ($null -ne $temporary -and [System.IO.File]::Exists($temporary)) { [System.IO.File]::Delete($temporary) }
}
`;

const readScript = String.raw`
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Security
$inputStream = [Console]::OpenStandardInput()
$memory = New-Object System.IO.MemoryStream
$protected = $null
$plaintext = $null
try {
  $inputStream.CopyTo($memory)
  $protected = $memory.ToArray()
  $plaintext = [System.Security.Cryptography.ProtectedData]::Unprotect($protected, $null, [System.Security.Cryptography.DataProtectionScope]::CurrentUser)
  $output = [Console]::OpenStandardOutput()
  $output.Write($plaintext, 0, $plaintext.Length)
  $output.Flush()
} finally {
  if ($null -ne $plaintext) { [Array]::Clear($plaintext, 0, $plaintext.Length) }
  if ($null -ne $protected) { [Array]::Clear($protected, 0, $protected.Length) }
  $memory.Dispose()
}
`;

const inheritedEnvironmentKeys = [
  "APPDATA", "ComSpec", "HOMEDRIVE", "HOMEPATH", "LOCALAPPDATA", "PATH", "PATHEXT",
  "ProgramData", "SystemRoot", "TEMP", "TMP", "USERPROFILE", "WINDIR"
] as const;

function validateSecretName(name: string): void {
  if (!allowedSecretNames.has(name)) throw new Error("Unsupported secret name");
}

function requireWindows(platform: NodeJS.Platform): void {
  if (platform !== "win32") throw new Error("Windows DPAPI is available only on Windows");
}

function createPowerShellEnvironment(environment: Record<string, string>): NodeJS.ProcessEnv {
  const inherited: NodeJS.ProcessEnv = {};
  for (const key of inheritedEnvironmentKeys) {
    const value = process.env[key];
    if (value !== undefined) inherited[key] = value;
  }
  return { ...inherited, ...environment };
}

function sameFile(before: Stats, after: Stats): boolean {
  return before.dev === after.dev && before.ino === after.ino;
}

async function readProtectedBytesBounded(handle: Awaited<ReturnType<typeof open>>): Promise<Buffer> {
  const bounded = Buffer.allocUnsafe(maxProtectedSecretBytes + 1);
  let total = 0;
  try {
    while (total < bounded.length) {
      const { bytesRead } = await handle.read(bounded, total, bounded.length - total, null);
      if (bytesRead === 0) break;
      total += bytesRead;
    }
    if (total < 1 || total > maxProtectedSecretBytes) throw new Error("Windows DPAPI operation failed");
    return Buffer.from(bounded.subarray(0, total));
  } finally {
    bounded.fill(0);
  }
}

async function runPowerShell(platform: NodeJS.Platform, script: string, standardInput?: Buffer, environment: Record<string, string> = {}): Promise<Buffer> {
  requireWindows(platform);
  const scriptBytes = Buffer.from(script, "utf16le");
  const encodedScript = scriptBytes.toString("base64");
  scriptBytes.fill(0);

  return new Promise((resolve, reject) => {
    const child = spawn("powershell.exe", ["-NoProfile", "-NonInteractive", "-EncodedCommand", encodedScript], {
      env: createPowerShellEnvironment(environment),
      stdio: ["pipe", "pipe", "pipe"],
      windowsHide: true
    });
    const output: Buffer[] = [];
    let outputBytes = 0;
    let settled = false;
    const clearOutput = () => {
      for (const chunk of output) chunk.fill(0);
      output.length = 0;
    };
    const fail = () => {
      if (settled) return;
      settled = true;
      clearOutput();
      reject(new Error("Windows DPAPI operation failed"));
    };
    const succeed = () => {
      if (settled) return;
      settled = true;
      const result = Buffer.concat(output);
      clearOutput();
      resolve(result);
    };
    child.stdout.on("data", (chunk: Buffer) => {
      if (settled) chunk.fill(0);
      else if (outputBytes + chunk.length > maxPlaintextSecretBytes) {
        chunk.fill(0);
        child.kill();
        fail();
      } else {
        outputBytes += chunk.length;
        output.push(chunk);
      }
    });
    child.stdout.once("error", fail);
    child.stderr.resume();
    child.stderr.once("error", fail);
    child.stdin.once("error", fail);
    child.once("error", fail);
    child.once("close", (code) => {
      if (code === 0) succeed();
      else fail();
    });
    try {
      child.stdin.end(standardInput);
    } catch {
      fail();
    }
  });
}

export class WindowsDpapiSecretStore implements SecretStore {
  public constructor(private readonly secretsDir: string, private readonly options: WindowsDpapiSecretStoreOptions = {}) {}

  private get platform(): NodeJS.Platform {
    return this.options.platform ?? process.platform;
  }

  public async protectSecret(name: string, plaintext: string): Promise<void> {
    validateSecretName(name);
    requireWindows(this.platform);
    const bytes = Buffer.from(plaintext, "utf8");
    try {
      const output = await runPowerShell(this.platform, protectScript, bytes, {
        LYJ_WORKBENCH_DPAPI_FAILURE_POINT: this.options.failurePoint ?? "",
        LYJ_WORKBENCH_SECRET_PATH: join(this.secretsDir, `${name}.bin`)
      });
      output.fill(0);
    } finally {
      bytes.fill(0);
    }
  }

  public async readSecret(name: string): Promise<string | null> {
    validateSecretName(name);
    requireWindows(this.platform);
    const filesystem = this.options.fileSystem ?? nativeFileSystem;
    const executePowerShell = this.options.runPowerShell ?? runPowerShell;
    let rootBefore: Stats;
    let canonicalRoot: string;
    try {
      rootBefore = await filesystem.lstat(this.secretsDir);
      if (!rootBefore.isDirectory() || rootBefore.isSymbolicLink()) throw new Error();
      canonicalRoot = await filesystem.realpath(this.secretsDir);
    } catch {
      throw new Error("Windows DPAPI operation failed");
    }
    const path = join(this.secretsDir, `${name}.bin`);
    if (resolve(path) !== path || !resolve(path).startsWith(`${resolve(this.secretsDir)}${sep}`)) throw new Error("Windows DPAPI operation failed");
    let before: Stats;
    try {
      before = await filesystem.lstat(path);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
      throw new Error("Windows DPAPI operation failed");
    }
    if (!before.isFile() || before.isSymbolicLink()) throw new Error("Windows DPAPI operation failed");
    try {
      if (!(await filesystem.realpath(path)).startsWith(`${canonicalRoot}${sep}`)) throw new Error();
    } catch {
      throw new Error("Windows DPAPI operation failed");
    }

    let handle: Awaited<ReturnType<typeof open>> | undefined;
    let protectedBytes: Buffer | undefined;
    try {
      handle = await filesystem.open(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
      const opened = await handle.stat();
      if (!opened.isFile() || !sameFile(before, opened) || opened.size < 1 || opened.size > maxProtectedSecretBytes) throw new Error("Windows DPAPI operation failed");
      protectedBytes = await readProtectedBytesBounded(handle);
      const rootAfter = await filesystem.lstat(this.secretsDir);
      const candidateAfter = await filesystem.lstat(path);
      if (!rootAfter.isDirectory() || rootAfter.isSymbolicLink() || !sameFile(rootBefore, rootAfter)
        || await filesystem.realpath(this.secretsDir) !== canonicalRoot || candidateAfter.isSymbolicLink()
        || !sameFile(opened, candidateAfter)) throw new Error("Windows DPAPI operation failed");
      const bytes = await executePowerShell(this.platform, readScript, protectedBytes);
      try {
        if (bytes.length > maxPlaintextSecretBytes) throw new Error("Windows DPAPI operation failed");
        return bytes.toString("utf8");
      } finally {
        bytes.fill(0);
      }
    } catch {
      throw new Error("Windows DPAPI operation failed");
    } finally {
      if (protectedBytes) protectedBytes.fill(0);
      if (handle) await handle.close().catch(() => undefined);
    }
  }
}
