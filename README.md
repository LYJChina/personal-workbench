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

On Windows, this command first retires the two exact legacy LYJ Workbench reminder tasks left by older releases. It never creates or synchronizes a task. On macOS and other platforms the retirement step is a no-op.

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

On Windows, local startup performs the same one-time-safe legacy task retirement before starting the server. If Windows confirms that an old task exists but refuses to delete it, startup stops with: `旧版提醒任务清理失败，请在 Windows 任务计划程序中删除 LYJ Workbench 的旧提醒任务后重试。` Delete only the old LYJ Workbench reminder tasks in Task Scheduler, then run the command again.

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

## Reminder center

The **提醒事项** page supports creating, viewing, editing, and deleting one-time, finite-count, and recurring reminders. Reminder metadata can use an exact date and time, daily, weekly, monthly, or Chinese workdays. Automatic reminder execution is disabled; use **测试邮件** on a reminder when you want to send its email manually.

The home page includes a monthly calendar and a scrollable list of reminder dates. Use **更新节假日** on the calendar to refresh the current and next year from the public Chinese holiday dataset. Reminder dates and repetition rules remain stored for display and future plugins, but the core application does not run them automatically.

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

The script only checks that no LYJ Workbench server is listening on `127.0.0.1:3001`, then prints the local data path. If the workbench used a non-default port, pass the same value with `-Port`.

Do not copy data unless the script prints `Backup preparation complete`. This prevents SQLite writes while the copy is in progress.

Copy the entire `%LOCALAPPDATA%\LYJWorkBench` directory to a protected local backup location. Keep the backup access restricted because it contains personal data and encrypted credential blobs. After the copy completes, resume the server.

## Restore on the same Windows account

1. Stop the server and run `powershell -NoProfile -File scripts/prepare-backup.ps1`; continue only after it reports completion.
2. Rename the current `%LOCALAPPDATA%\LYJWorkBench` directory as a recoverable pre-restore copy.
3. Copy the backed-up `LYJWorkBench` directory into `%LOCALAPPDATA%`.
4. Start the workbench and verify the profile, theme, layout, reports, and reminder settings.
5. Test provider connections manually. If DPAPI cannot decrypt a restored blob, re-enter the corresponding secret in Settings.

## Transfer to another Windows computer or account

Project files, `workbench.sqlite`, and `uploads` can be transferred. On the destination computer, install the prerequisites, run `pnpm install`, then `pnpm build`. With the server stopped, copy the database and uploads into the destination account’s `%LOCALAPPDATA%\LYJWorkBench` directory.

DPAPI secret blobs are bound to their Windows protection context. They cannot be reused by another Windows account, and copied blobs should not be relied on after a computer or account migration. Do not transfer the `secrets` directory as usable credentials; re-enter the DeepSeek API key and SMTP password under the destination Windows account, then run the explicit connection tests.
