# LYJ Workbench

LYJ Workbench is a Windows-only personal workbench. Its production-local server binds only to `127.0.0.1`, and the built web UI and API share that single loopback origin. It does not deploy or synchronize data to a cloud service.

## Prerequisites

- Windows 10 or Windows 11 under the Windows account that will use the workbench
- Node.js 22
- PowerShell 5.1 or later
- pnpm 11.19.0 (the repository pins `pnpm@11.19.0`)

From PowerShell in the project directory, install dependencies:

```powershell
corepack enable
corepack prepare pnpm@11.19.0 --activate
pnpm install
```

## Development

Start the Vite web development server and the Express API watcher together:

```powershell
pnpm dev
```

Open the development UI at `http://127.0.0.1:5173`. The API listens only on `http://127.0.0.1:3001`, and Vite forwards browser requests under `/api` to that exact loopback target so the development UI is API-functional.

To use a different API port, set the same validated integer port for the Express server and Vite proxy before starting:

```powershell
$env:PORT = '43123'
$env:LYJ_WORKBENCH_API_PORT = '43123'
pnpm dev
```

The proxy target host cannot be overridden and remains `127.0.0.1`; malformed or out-of-range port overrides stop startup. Stop both development processes with `Ctrl+C`, then remove the two temporary environment values if they are no longer needed:

```powershell
Remove-Item Env:PORT, Env:LYJ_WORKBENCH_API_PORT -ErrorAction SilentlyContinue
```

## Build and production-local start

Build every workspace package, including `apps/web/dist` and the compiled server entries:

```powershell
pnpm build
```

Start the production-local server and open the workbench after its health check succeeds:

```powershell
pnpm local:start
```

The default URL is `http://127.0.0.1:3001`. To suppress browser opening or choose another loopback port:

```powershell
pnpm local:start -NoOpen
pnpm local:start -Port 43123
```

`local:start` rejects malformed ports and starts the server with the host fixed to `127.0.0.1`; external interfaces and hostnames are not supported. Stop it with `Ctrl+C`. Re-run `pnpm build` after changing source files.

## DeepSeek settings

Open **设置 → DeepSeek**. Enter the HTTPS API address, model name, and API key, save, then use **测试 DeepSeek 连接**. The API key field is blank on every load; leaving it blank preserves the already stored key. The key is protected for the current Windows account with DPAPI and is never returned to the browser or stored in SQLite.

No real DeepSeek request occurs during install, build, or local startup. Daily Report generation requires a saved, working DeepSeek configuration and sends the entered report material to the configured provider only when the user clicks Generate.

## SMTP settings

Open **设置 → 邮件**. Enter the SMTP host, port, transport mode (`STARTTLS` or `TLS`), username, from address, and password. Save, then use **测试邮件连接**. The password field is blank on every load; leaving it blank preserves the stored password. The SMTP password is DPAPI-protected and is loaded only when a connection or delivery is attempted.

No email is sent during install, build, or local startup. The reminder page’s **发送测试邮件** action sends a real email when valid SMTP settings and a recipient are present.

## Monday reminder task

Build before inspecting or installing the task. The scripts operate only on the exact current-user task `\LYJWorkBench-OutboundCheckin`.

Preview installation without changing Task Scheduler:

```powershell
powershell -NoProfile -File scripts/install-reminder-task.ps1 -WhatIf
```

Install after reviewing the preview:

```powershell
powershell -NoProfile -File scripts/install-reminder-task.ps1
```

Preview removal, then remove only that exact task:

```powershell
powershell -NoProfile -File scripts/uninstall-reminder-task.ps1 -WhatIf
powershell -NoProfile -File scripts/uninstall-reminder-task.ps1
```

Changing the reminder time in the web UI does not silently replace a Windows scheduled task. When the reminder page shows the scheduler reinstall warning, run the installer again and confirm replacement so Task Scheduler and the saved reminder time match.

## Local data

Application data is stored under:

```text
%LOCALAPPDATA%\LYJWorkBench\
├── workbench.sqlite
├── uploads\
└── secrets\
```

- `workbench.sqlite` contains profile, preferences, non-secret settings, daily reports, reminders, and sanitized delivery status.
- `uploads` contains profile images.
- `secrets` contains encrypted DPAPI blobs, not plaintext credentials.

Do not place credentials in project files, environment files, command arguments, or backup notes.

## Backup

Before copying application data, stop `pnpm local:start` or `pnpm dev` with `Ctrl+C`, then run the verified preparation script:

```powershell
powershell -NoProfile -File scripts/prepare-backup.ps1
```

The script queries only the exact root task `\LYJWorkBench-OutboundCheckin`, disables future triggers, stops that task if it is currently `Running`, re-queries it, and fails unless it is no longer running. It also fails while an LYJ Workbench server is still listening on `127.0.0.1:3001`. If the workbench used a non-default port, pass the same value with `-Port`.

Do not copy data unless the script prints `Backup preparation complete`. This prevents SQLite writes while the copy is in progress.

Copy the entire `%LOCALAPPDATA%\LYJWorkBench` directory to a protected local backup location. Keep the backup access restricted because it contains personal data and encrypted credential blobs. After the copy completes, re-enable the exact task if you disabled it, then resume the server:

```powershell
Enable-ScheduledTask -TaskPath '\' -TaskName 'LYJWorkBench-OutboundCheckin'
```

## Restore on the same Windows account

1. Stop the server and run `powershell -NoProfile -File scripts/prepare-backup.ps1`; continue only after it reports completion.
2. Rename the current `%LOCALAPPDATA%\LYJWorkBench` directory as a recoverable pre-restore copy.
3. Copy the backed-up `LYJWorkBench` directory into `%LOCALAPPDATA%`.
4. Start the workbench and verify the profile, theme, layout, reports, and reminder settings.
5. Test provider connections manually. If DPAPI cannot decrypt a restored blob, re-enter the corresponding secret in Settings.
6. Reinstall the scheduled task if its registered project path or reminder time changed.

## Transfer to another Windows computer or account

Project files, `workbench.sqlite`, and `uploads` can be transferred. On the destination computer, install the prerequisites, run `pnpm install`, then `pnpm build`. With the server and reminder task stopped, copy the database and uploads into the destination account’s `%LOCALAPPDATA%\LYJWorkBench` directory.

DPAPI secret blobs are bound to their Windows protection context. They cannot be reused by another Windows account, and copied blobs should not be relied on after a computer or account migration. Do not transfer the `secrets` directory as usable credentials; re-enter the DeepSeek API key and SMTP password under the destination Windows account, then run the explicit connection tests.

Finally, preview and reinstall `\LYJWorkBench-OutboundCheckin` on the destination computer. A scheduled task stores absolute Node, project, and compiled-entry paths, so copying project files does not migrate a working task registration.
