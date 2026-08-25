import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type { PasswordManagerEntryDetail, PasswordManagerEntryInput, PasswordManagerEntrySummary, PasswordManagerStatus } from "@workbench/contracts";
import { PasswordManagerPage, type PasswordManagerApi } from "./PasswordManagerPage";

const entry: PasswordManagerEntrySummary = { id: "550e8400-e29b-41d4-a716-446655440000", name: "GitHub", website: "https://github.com", username: "ada", notes: "work", customFields: [], createdAt: "2026-08-26T00:00:00.000Z", updatedAt: "2026-08-26T00:00:00.000Z" };
const status: PasswordManagerStatus = { configured: true, unlocked: true, idleTimeoutMinutes: 10 };
function createApi(overrides: Partial<PasswordManagerApi> = {}): PasswordManagerApi {
  return { status: vi.fn().mockResolvedValue(status), setup: vi.fn(), unlock: vi.fn(), lock: vi.fn().mockResolvedValue(undefined), listEntries: vi.fn().mockResolvedValue([entry]), createEntry: vi.fn(), updateEntry: vi.fn(), deleteEntry: vi.fn().mockResolvedValue(undefined), revealEntry: vi.fn().mockResolvedValue({ ...entry, password: "secret" } satisfies PasswordManagerEntryDetail), importEntries: vi.fn(), requestRedactedAiHelp: vi.fn(), ...overrides };
}

describe("password manager", () => {
  it("gates locked vaults behind setup or unlock without loading entries", async () => {
    const api = createApi({ status: vi.fn().mockResolvedValue({ configured: false, unlocked: false, idleTimeoutMinutes: 10 }) });
    render(<PasswordManagerPage api={api} />);
    expect(await screen.findByRole("heading", { name: "设置独立密码" })).toBeVisible();
    expect(api.listEntries).not.toHaveBeenCalled();
  });

  it("searches, reveals and copies only on explicit action, then clears on lock", async () => {
    const user = userEvent.setup();
    const clipboard = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText: clipboard } });
    const api = createApi();
    render(<PasswordManagerPage api={api} />);
    await screen.findByText("GitHub");
    await user.type(screen.getByLabelText("搜索凭据"), "missing");
    expect(screen.queryByText("GitHub")).not.toBeInTheDocument();
    await user.clear(screen.getByLabelText("搜索凭据"));
    await user.click(screen.getByRole("button", { name: "显示密码 GitHub" }));
    expect(await screen.findByDisplayValue("secret")).toBeVisible();
    await user.click(screen.getByRole("button", { name: "复制密码 GitHub" }));
    expect(clipboard).toHaveBeenCalledWith("secret");
    await user.click(screen.getByRole("button", { name: "锁定密码库" }));
    await waitFor(() => expect(api.lock).toHaveBeenCalled());
    expect(screen.queryByDisplayValue("secret")).not.toBeInTheDocument();
  });

  it("requires confirmation before deleting a credential", async () => {
    const user = userEvent.setup(); const api = createApi();
    render(<PasswordManagerPage api={api} />);
    await screen.findByText("GitHub");
    await user.click(screen.getByRole("button", { name: "删除 GitHub" }));
    expect(api.deleteEntry).not.toHaveBeenCalled();
    await user.click(screen.getByRole("button", { name: "确认删除 GitHub" }));
    await waitFor(() => expect(api.deleteEntry).toHaveBeenCalledWith(entry.id));
  });

  it("shows a local preview and never imports until the user confirms", async () => {
    const user = userEvent.setup(); const api = createApi({ importEntries: vi.fn().mockResolvedValue(undefined) });
    render(<PasswordManagerPage api={api} />);
    await screen.findByText("GitHub");
    await user.click(screen.getByRole("button", { name: "导入凭据" }));
    await user.type(screen.getByLabelText("导入文本"), "name,username,password\nMail,ada,pw");
    await user.click(screen.getByRole("button", { name: "预览导入" }));
    expect(await screen.findByText("Mail")).toBeVisible();
    expect(api.importEntries).not.toHaveBeenCalled();
    await user.click(screen.getByRole("button", { name: "确认导入 1 条" }));
    expect(api.importEntries).toHaveBeenCalledWith([expect.objectContaining({ name: "Mail", password: "pw" })]);
  });
});
