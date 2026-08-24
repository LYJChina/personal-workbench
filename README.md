# LYJ Workbench

LYJ Workbench is a local personal workbench for Windows and macOS. Its production-local server binds only to `127.0.0.1`; the built web interface and API share that loopback origin. The application does not deploy or synchronize its database to a cloud service.

## Prerequisites

- Windows 10/11 or a currently supported macOS release
- Node.js 22
- pnpm 11.19.0 (pinned by this repository)

Use the same project commands on Windows and macOS:

```text
pnpm install
pnpm dev
pnpm build
pnpm local:start
```

`pnpm install` installs every workspace dependency. `pnpm dev` starts the Vite interface at `http://127.0.0.1:5173` and the Express API at `http://127.0.0.1:3001`; Vite forwards `/api` requests to that exact loopback API. Stop development with `Ctrl+C`.

Run `pnpm build` before `pnpm local:start`. The production-local launcher waits for its own server health check and then opens `http://127.0.0.1:3001`. Its flags use Node command-line syntax on both platforms:

```text
pnpm local:start --no-open
pnpm local:start --port 43123
pnpm local:start --no-open --port 43123
```

The host is always canonical IPv4 loopback. Invalid or out-of-range ports stop startup. Rebuild after changing source files.

On Windows only, `pnpm dev` and `pnpm local:start` may perform an exact, one-time retirement of two scheduled tasks created by old LYJ Workbench releases. This compatibility cleanup never creates a task or provides automatic reminder delivery. It is a no-op on macOS. If Windows refuses to delete one of those exact old tasks, delete only the named LYJ Workbench task in Task Scheduler and retry.

## Windows and macOS data locations

All current user data—including skin, density, radius, and glass appearance preferences—is authoritative in one SQLite database:

- Windows: `%LOCALAPPDATA%\LYJWorkBench\workbench.sqlite`
- macOS: `~/Library/Application Support/LYJWorkBench/workbench.sqlite`

The database contains profile fields and the profile photo, preferences, settings, encrypted vault metadata and secrets, reminders, and history. An `uploads` directory or legacy `secrets` directory may remain after an upgrade, but neither is part of the current authoritative backup. Do not place credentials in project files, environment files, command arguments, or backup notes.

## Local vault and provider settings

On first use, create a master password in the vault screen. On later starts, unlock the vault with that password before using the protected application. DeepSeek API keys and SMTP passwords are encrypted inside `workbench.sqlite`; plaintext secret values are never returned to the browser. Leaving a secret input blank in Settings preserves its stored value.

The encrypted vault is portable between Windows and macOS. A restored database requires the same master password. Losing that password means the encrypted secrets cannot be recovered.

Older Windows releases stored secrets as account-bound DPAPI files. When those files are detected under the original Windows account, first-time vault setup can perform a one-time import into the portable vault. This is the only supported DPAPI path: normal storage, unlock, backup, and use do not depend on DPAPI or PowerShell. Complete the import on the original Windows account before moving the database to another computer.

Open **设置 → DeepSeek** to configure the HTTPS API address, model, and API key, and use **测试 DeepSeek 连接** when you explicitly want a connection test. Provider content is sent only when you invoke an AI action.

Open **设置 → 邮件通知** to retain SMTP host, port, transport mode (`STARTTLS` or `TLS`), username, sender address, and password. Email is sent only when you explicitly use a reminder's manual **测试邮件** action. Installation, build, startup, and reminder schedules do not send email automatically.

## Reminders

The **提醒事项** page supports one-time, finite-count, and recurring reminder metadata. Dates and repetition rules remain available for display and future extensions. The core application has no automatic reminder-delivery scheduler; use the manual test-email action when you intend to send a message.

The home calendar can refresh Chinese holiday data for the current and next year. Calendar synchronization changes local calendar data only and does not deliver reminders.

## Export a backup

Open **设置 → 备份与迁移** and choose **导出数据库**. The running application creates a consistent SQLite snapshot with SQLite's online-backup mechanism, validates its integrity, and downloads a file named like `LYJWorkBench-backup-2026-08-23.sqlite`. You do not need to stop the application before exporting.

Before upgrading an existing version-zero database, startup creates and validates an exceptional migration recovery snapshot. The snapshot may precede the migration write lock, so it is retained only for operator diagnosis/recovery and is never copied automatically over the live database. All pending versions run under one SQLite write transaction; a failure rolls that transaction back in place without replacing the database or deleting its WAL/SHM sidecars. Successful migrations remove the artifact.

The exported database includes profile data and the photo, encrypted keys, settings, reminders, and history. Keep it in a protected location because it contains personal data and encrypted credential material. Secrets remain encrypted and are not directly readable as plaintext; the same master password is required after transfer.

## Restore or migrate

1. Stop `pnpm dev` or `pnpm local:start` with `Ctrl+C` on the destination computer.
2. Locate the destination data directory listed above.
3. Create a separate recovery folder. Move the current `workbench.sqlite` and, if present, its `workbench.sqlite-wal` and `workbench.sqlite-shm` sidecars into that folder together as the same recoverable set. Do not delete or separate these files until the restored application has been verified.
4. Confirm that all three original names are absent from the data directory before copying the exported database. This isolates old WAL/SHM state before placing the exported database.
5. Copy the exported SQLite file into the data directory and name it exactly `workbench.sqlite`. Replace only this database set; do not replace the whole data directory or copy sidecars from another database.
6. Start the application, unlock it with the same master password, and verify the profile, photo, settings, reminders, and history.
7. Run provider and SMTP connection tests manually if needed.

If verification fails, stop the application again. Move the failed restored `workbench.sqlite` and any newly created `workbench.sqlite-wal` and `workbench.sqlite-shm` into a separate diagnostic folder together as a set. Then roll back by moving the retained original database and its matching sidecars from the recovery folder back into the data directory as the same set. Never mix a database with sidecars from the other set.

## Verification

The repository continuously runs the same checks on `windows-latest` and `macos-latest` with Node 22 and pnpm 11.19.0:

```text
pnpm check
pnpm test
pnpm build
```

The full test command covers the cross-platform launcher, security boundaries, vault and API behavior, one-time legacy import, database/profile migrations, and online backup export.
