import { spawn } from "node:child_process";
import { access } from "node:fs/promises";
import { constants } from "node:fs";
import { join } from "node:path";

export interface SecretStore {
  protectSecret(name: string, plaintext: string): Promise<void>;
  readSecret(name: string): Promise<string | null>;
}

const allowedSecretNames = new Set(["deepseek-api-key", "smtp-password", "dpapi-test-secret"]);

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
$directoryInfo = New-Object System.IO.DirectoryInfo($directory)
Set-CurrentUserOnlyAcl $directoryInfo ([System.Security.AccessControl.InheritanceFlags]'ContainerInherit,ObjectInherit')
$inputStream = [Console]::OpenStandardInput()
$memory = New-Object System.IO.MemoryStream
$temporary = $null
$backup = $null
try {
  $inputStream.CopyTo($memory)
  $plaintext = $memory.ToArray()
  try {
    $protected = [System.Security.Cryptography.ProtectedData]::Protect($plaintext, $null, [System.Security.Cryptography.DataProtectionScope]::CurrentUser)
    $temporary = [System.IO.Path]::Combine($directory, [System.IO.Path]::GetRandomFileName())
    [System.IO.File]::WriteAllBytes($temporary, $protected)
    $fileInfo = New-Object System.IO.FileInfo($temporary)
    Set-CurrentUserOnlyAcl $fileInfo ([System.Security.AccessControl.InheritanceFlags]::None)
    if ([System.IO.File]::Exists($target)) {
      $backup = [System.IO.Path]::Combine($directory, [System.IO.Path]::GetRandomFileName())
      [System.IO.File]::Replace($temporary, $target, $backup, $true)
      [System.IO.File]::Delete($backup)
      $backup = $null
    } else {
      [System.IO.File]::Move($temporary, $target)
    }
    $temporary = $null
    $targetInfo = New-Object System.IO.FileInfo($target)
    Set-CurrentUserOnlyAcl $targetInfo ([System.Security.AccessControl.InheritanceFlags]::None)
  } finally {
    if ($null -ne $plaintext) { [Array]::Clear($plaintext, 0, $plaintext.Length) }
  }
} finally {
  $memory.Dispose()
  if ($null -ne $temporary -and [System.IO.File]::Exists($temporary)) { [System.IO.File]::Delete($temporary) }
  if ($null -ne $backup -and [System.IO.File]::Exists($backup)) { [System.IO.File]::Delete($backup) }
}
`;

const readScript = String.raw`
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Security
$protected = [System.IO.File]::ReadAllBytes($env:LYJ_WORKBENCH_SECRET_PATH)
$plaintext = [System.Security.Cryptography.ProtectedData]::Unprotect($protected, $null, [System.Security.Cryptography.DataProtectionScope]::CurrentUser)
try {
  $output = [Console]::OpenStandardOutput()
  $output.Write($plaintext, 0, $plaintext.Length)
  $output.Flush()
} finally {
  [Array]::Clear($plaintext, 0, $plaintext.Length)
}
`;

function validateSecretName(name: string): void {
  if (!allowedSecretNames.has(name)) throw new Error("Unsupported secret name");
}

async function runPowerShell(script: string, secretPath: string, standardInput?: Buffer): Promise<Buffer> {
  if (process.platform !== "win32") throw new Error("Windows DPAPI is available only on Windows");
  const encodedScript = Buffer.from(script, "utf16le").toString("base64");

  return new Promise((resolve, reject) => {
    const child = spawn("powershell.exe", ["-NoProfile", "-NonInteractive", "-EncodedCommand", encodedScript], {
      env: { ...process.env, LYJ_WORKBENCH_SECRET_PATH: secretPath },
      stdio: ["pipe", "pipe", "pipe"],
      windowsHide: true
    });
    const output: Buffer[] = [];
    child.stdout.on("data", (chunk: Buffer) => output.push(chunk));
    child.stderr.resume();
    child.once("error", () => reject(new Error("Windows DPAPI operation failed")));
    child.once("close", (code) => {
      if (code === 0) resolve(Buffer.concat(output));
      else reject(new Error("Windows DPAPI operation failed"));
    });
    child.stdin.end(standardInput);
  });
}

export class WindowsDpapiSecretStore implements SecretStore {
  public constructor(private readonly secretsDir: string) {}

  public async protectSecret(name: string, plaintext: string): Promise<void> {
    validateSecretName(name);
    const bytes = Buffer.from(plaintext, "utf8");
    try {
      await runPowerShell(protectScript, join(this.secretsDir, `${name}.bin`), bytes);
    } finally {
      bytes.fill(0);
    }
  }

  public async readSecret(name: string): Promise<string | null> {
    validateSecretName(name);
    const path = join(this.secretsDir, `${name}.bin`);
    try {
      await access(path, constants.F_OK);
    } catch {
      return null;
    }
    const bytes = await runPowerShell(readScript, path);
    try {
      return bytes.toString("utf8");
    } finally {
      bytes.fill(0);
    }
  }
}
