[CmdletBinding()]
param(
    [switch]$NoOpen,
    [string]$ProjectRoot,
    [string]$NodePath,
    [string]$ServerEntryPath,
    [string]$Port,
    [ValidateRange(1, 300)][int]$HealthTimeoutSeconds = 30
)

$ErrorActionPreference = 'Stop'

Add-Type -TypeDefinition @'
using System;
using System.ComponentModel;
using System.Runtime.InteropServices;

public static class LYJWorkbenchProcessJob
{
    private const uint KillOnJobClose = 0x00002000;

    [StructLayout(LayoutKind.Sequential)]
    private struct BasicLimitInformation
    {
        public long PerProcessUserTimeLimit;
        public long PerJobUserTimeLimit;
        public uint LimitFlags;
        public UIntPtr MinimumWorkingSetSize;
        public UIntPtr MaximumWorkingSetSize;
        public uint ActiveProcessLimit;
        public long Affinity;
        public uint PriorityClass;
        public uint SchedulingClass;
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct IoCounters
    {
        public ulong ReadOperationCount;
        public ulong WriteOperationCount;
        public ulong OtherOperationCount;
        public ulong ReadTransferCount;
        public ulong WriteTransferCount;
        public ulong OtherTransferCount;
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct ExtendedLimitInformation
    {
        public BasicLimitInformation BasicLimitInformation;
        public IoCounters IoInfo;
        public UIntPtr ProcessMemoryLimit;
        public UIntPtr JobMemoryLimit;
        public UIntPtr PeakProcessMemoryUsed;
        public UIntPtr PeakJobMemoryUsed;
    }

    [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    private static extern IntPtr CreateJobObject(IntPtr securityAttributes, string name);

    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern bool SetInformationJobObject(
        IntPtr job,
        int informationClass,
        ref ExtendedLimitInformation information,
        uint informationLength);

    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern bool AssignProcessToJobObject(IntPtr job, IntPtr process);

    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern bool CloseHandle(IntPtr handle);

    public static IntPtr CreateKillOnClose()
    {
        IntPtr job = CreateJobObject(IntPtr.Zero, null);
        if (job == IntPtr.Zero) throw new Win32Exception(Marshal.GetLastWin32Error());

        var information = new ExtendedLimitInformation();
        information.BasicLimitInformation.LimitFlags = KillOnJobClose;
        if (!SetInformationJobObject(job, 9, ref information, (uint)Marshal.SizeOf(typeof(ExtendedLimitInformation))))
        {
            int error = Marshal.GetLastWin32Error();
            CloseHandle(job);
            throw new Win32Exception(error);
        }
        return job;
    }

    public static void Assign(IntPtr job, IntPtr process)
    {
        if (!AssignProcessToJobObject(job, process))
            throw new Win32Exception(Marshal.GetLastWin32Error());
    }

    public static void Close(IntPtr job)
    {
        if (job != IntPtr.Zero) CloseHandle(job);
    }
}
'@

if ([string]::IsNullOrWhiteSpace($ProjectRoot)) {
    $ProjectRoot = Join-Path $PSScriptRoot '..'
}
$ResolvedProjectRoot = [System.IO.Path]::GetFullPath($ProjectRoot)
if (-not (Test-Path -LiteralPath $ResolvedProjectRoot -PathType Container)) {
    throw 'The project directory was not found.'
}

if ([string]::IsNullOrWhiteSpace($NodePath)) {
    $NodePath = (Get-Command 'node.exe' -ErrorAction Stop).Source
}
$ResolvedNodePath = [System.IO.Path]::GetFullPath($NodePath)
if (-not (Test-Path -LiteralPath $ResolvedNodePath -PathType Leaf)) {
    throw 'node.exe was not found at the configured path.'
}

if ([string]::IsNullOrWhiteSpace($ServerEntryPath)) {
    $ServerEntryPath = Join-Path $ResolvedProjectRoot 'apps\server\dist\index.js'
}
$ResolvedServerEntryPath = [System.IO.Path]::GetFullPath($ServerEntryPath)
if (-not (Test-Path -LiteralPath $ResolvedServerEntryPath -PathType Leaf)) {
    throw 'The compiled server entry was not found. Run pnpm build first.'
}

$WebIndexPath = Join-Path $ResolvedProjectRoot 'apps\web\dist\index.html'
if (-not (Test-Path -LiteralPath $WebIndexPath -PathType Leaf)) {
    throw 'The built web UI was not found. Run pnpm build first.'
}

if ([string]::IsNullOrEmpty($Port)) {
    if ([string]::IsNullOrEmpty($env:PORT)) { $Port = '3001' } else { $Port = $env:PORT }
}
if ($Port -notmatch '^[1-9]\d*$') {
    throw 'PORT must be an integer from 1 through 65535.'
}
$ParsedPort = 0
if (-not [int]::TryParse($Port, [ref]$ParsedPort) -or $ParsedPort -gt 65535) {
    throw 'PORT must be an integer from 1 through 65535.'
}

$Url = "http://127.0.0.1:$ParsedPort"
$HealthUrl = "$Url/api/health"
$StartInfo = New-Object System.Diagnostics.ProcessStartInfo
$StartInfo.FileName = $ResolvedNodePath
$StartInfo.Arguments = '"' + $ResolvedServerEntryPath + '"'
$StartInfo.WorkingDirectory = $ResolvedProjectRoot
$StartInfo.UseShellExecute = $false
$StartInfo.CreateNoWindow = $true
$StartInfo.WindowStyle = [System.Diagnostics.ProcessWindowStyle]::Hidden
$StartInfo.EnvironmentVariables.Clear()
foreach ($Name in @('SystemRoot', 'WINDIR', 'TEMP', 'TMP', 'LOCALAPPDATA', 'APPDATA', 'USERPROFILE', 'HOMEDRIVE', 'HOMEPATH', 'Path', 'PATHEXT')) {
    $Value = [System.Environment]::GetEnvironmentVariable($Name)
    if (-not [string]::IsNullOrEmpty($Value)) {
        $StartInfo.EnvironmentVariables[$Name] = $Value
    }
}
$StartInfo.EnvironmentVariables['NODE_ENV'] = 'production'
$StartInfo.EnvironmentVariables['HOST'] = '127.0.0.1'
$StartInfo.EnvironmentVariables['PORT'] = [string]$ParsedPort

$Child = New-Object System.Diagnostics.Process
$Child.StartInfo = $StartInfo
$ChildStarted = $false
$JobHandle = [LYJWorkbenchProcessJob]::CreateKillOnClose()
$ExitCode = 1
try {
    if (-not $Child.Start()) {
        throw 'The local server process could not be started.'
    }
    $ChildStarted = $true
    [LYJWorkbenchProcessJob]::Assign($JobHandle, $Child.Handle)

    $Deadline = [DateTime]::UtcNow.AddSeconds($HealthTimeoutSeconds)
    $Healthy = $false
    while ([DateTime]::UtcNow -lt $Deadline) {
        if ($Child.HasExited) {
            throw "The local server exited before it became healthy (exit code $($Child.ExitCode))."
        }
        try {
            $Health = Invoke-RestMethod -Uri $HealthUrl -Method Get -TimeoutSec 2
            if ($Health.status -eq 'ok') {
                $Healthy = $true
                break
            }
        } catch {
            Start-Sleep -Milliseconds 200
        }
    }
    if (-not $Healthy) {
        throw "The local server did not become healthy within $HealthTimeoutSeconds seconds."
    }

    Write-Output "LYJ Workbench is ready at $Url"
    if (-not $NoOpen) {
        Start-Process -FilePath $Url | Out-Null
    }

    $Child.WaitForExit()
    $ExitCode = $Child.ExitCode
} finally {
    if ($ChildStarted -and -not $Child.HasExited) {
        Stop-Process -Id $Child.Id -Force -ErrorAction SilentlyContinue
        $Child.WaitForExit()
    }
    [LYJWorkbenchProcessJob]::Close($JobHandle)
    $Child.Dispose()
}

exit $ExitCode
