import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { VaultGate } from "./VaultGate";

function json(data: unknown, status = 200): Response {
  return new Response(status === 204 ? null : JSON.stringify(data), {
    status,
    headers: status === 204 ? undefined : { "Content-Type": "application/json" }
  });
}

describe("VaultGate", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("loads vault status before mounting protected application content", async () => {
    let resolveStatus!: (response: Response) => void;
    vi.stubGlobal("fetch", vi.fn(() => new Promise<Response>((resolve) => { resolveStatus = resolve; })));
    render(<VaultGate><div>受保护的工作台</div></VaultGate>);
    expect(screen.getByRole("status")).toHaveTextContent("正在检查本地保险库");
    expect(screen.queryByText("受保护的工作台")).not.toBeInTheDocument();
    resolveStatus(json({ configured: true, unlocked: true }));
    expect(await screen.findByText("受保护的工作台")).toBeVisible();
  });

  it("requires matching 12-character setup passwords and opens the app without reloading", async () => {
    const user = userEvent.setup();
    const fetchMock = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      if (String(input) === "/api/vault/status") return json({ configured: false, unlocked: false });
      if (String(input) === "/api/vault/enroll" && init?.method === "POST") return json({ state: "pending", maskedEmail: "o***@example.com", smtpHealth: "unknown", checkedAt: null }, 201);
      return json({}, 500);
    });
    vi.stubGlobal("fetch", fetchMock);
    render(<VaultGate><div>受保护的工作台</div></VaultGate>);

    const password = await screen.findByLabelText("设置主密码");
    const confirmation = screen.getByLabelText("确认主密码");
    fireEvent.change(password, { target: { value: "too-short" } });
    fireEvent.change(confirmation, { target: { value: "different" } });
    await user.click(screen.getByRole("button", { name: "设置并进入工作台" }));
    expect(screen.getByRole("alert")).toHaveTextContent("两次输入的主密码不一致");
    expect(fetchMock).toHaveBeenCalledTimes(2);

    fireEvent.change(password, { target: { value: "short-match" } });
    fireEvent.change(confirmation, { target: { value: "short-match" } });
    await user.click(screen.getByRole("button", { name: "设置并进入工作台" }));
    expect(screen.getByRole("alert")).toHaveTextContent("主密码须为 12 至 1024 个字符");
    expect(fetchMock).toHaveBeenCalledTimes(2);

    fireEvent.change(password, { target: { value: "correct horse battery staple" } });
    fireEvent.change(confirmation, { target: { value: "correct horse battery staple" } });
    await user.selectOptions(screen.getByLabelText("邮箱服务商"), "custom");
    await user.type(screen.getByLabelText("SMTP 主机"), "smtp.example.com");
    await user.clear(screen.getByLabelText("SMTP 端口"));
    await user.type(screen.getByLabelText("SMTP 端口"), "465");
    await user.type(screen.getByLabelText("SMTP 邮箱"), "owner@example.com");
    await user.type(screen.getByLabelText("SMTP 授权码"), "smtp-code");
    await user.type(screen.getByLabelText("恢复邮箱"), "backup@example.com");
    await user.click(screen.getByRole("button", { name: "设置并进入工作台" }));
    expect(await screen.findByText("确认恢复邮箱")).toBeVisible();
    const setupCall = fetchMock.mock.calls.find(([input]) => String(input) === "/api/vault/enroll");
    expect(JSON.parse(String(setupCall?.[1]?.body))).toEqual(expect.objectContaining({ masterPassword: "correct horse battery staple", recoveryEmail: "backup@example.com" }));
    expect(localStorage.length).toBe(0);
    expect(sessionStorage.length).toBe(0);
  });

  it("discloses detected legacy Windows keys only during first-time setup without rendering their values", async () => {
    const fetchMock = vi.fn(async (input: string | URL | Request) => {
      if (String(input) === "/api/vault/status") return json({ configured: false, unlocked: false });
      if (String(input) === "/api/vault/legacy-import-status") return json({ detected: true });
      return json({}, 500);
    });
    vi.stubGlobal("fetch", fetchMock);
    render(<VaultGate><div>受保护的工作台</div></VaultGate>);

    expect(await screen.findByText("检测到旧版 Windows 密钥，将在设置主密码后迁移")).toBeVisible();
    expect(screen.queryByText("legacy-api-value")).not.toBeInTheDocument();
    expect(fetchMock.mock.calls.map(([input]) => String(input))).toEqual([
      "/api/vault/status",
      "/api/vault/legacy-import-status"
    ]);
  });

  it("does not query legacy disclosure after the vault is configured", async () => {
    const fetchMock = vi.fn(async (input: string | URL | Request) => {
      if (String(input) === "/api/vault/status") return json({ configured: true, unlocked: false });
      return json({}, 500);
    });
    vi.stubGlobal("fetch", fetchMock);
    render(<VaultGate><div>受保护的工作台</div></VaultGate>);

    await screen.findByLabelText("主密码");
    expect(fetchMock.mock.calls.map(([input]) => String(input))).toEqual(["/api/vault/status"]);
  });

  it("resets a forgotten password with a one-time recovery code", async () => {
    const user = userEvent.setup();
    const fetchMock = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      if (String(input) === "/api/vault/status") return json({ configured: true, unlocked: false });
      if (String(input) === "/api/vault/recovery/code-reset" && init?.method === "POST") return json(null, 204);
      return json({}, 500);
    });
    vi.stubGlobal("fetch", fetchMock);
    render(<VaultGate><div>受保护的工作台</div></VaultGate>);

    await user.click(await screen.findByRole("button", { name: "忘记主密码" }));
    await user.click(screen.getByRole("button", { name: "使用邮件恢复码" }));
    await user.type(screen.getByLabelText("邮件恢复码"), "LYJ-AAAA-BBBB-CCCC-DDDD-EEEE-FFFF-GGGG-HHHH");
    await user.type(screen.getByLabelText("设置新主密码"), "replacement horse battery staple");
    await user.type(screen.getByLabelText("确认新主密码"), "replacement horse battery staple");
    await user.click(screen.getByRole("button", { name: "重设密码并进入" }));

    expect(await screen.findByText("受保护的工作台")).toBeVisible();
    const reset = fetchMock.mock.calls.find(([input]) => String(input) === "/api/vault/recovery/code-reset");
    expect(JSON.parse(String(reset?.[1]?.body))).toEqual({
      recoveryCode: "LYJ-AAAA-BBBB-CCCC-DDDD-EEEE-FFFF-GGGG-HHHH",
      newPassword: "replacement horse battery staple"
    });
  });

  it("does not start legacy disclosure after unmounting before an unconfigured status resolves", async () => {
    let resolveStatus!: (response: Response) => void;
    const fetchMock = vi.fn((_input: string | URL | Request) => new Promise<Response>((resolve) => { resolveStatus = resolve; }));
    vi.stubGlobal("fetch", fetchMock);
    const rendered = render(<VaultGate><div>受保护的工作台</div></VaultGate>);

    rendered.unmount();
    resolveStatus(json({ configured: false, unlocked: false }));
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(fetchMock.mock.calls.map(([input]) => String(input))).toEqual(["/api/vault/status"]);
  });

  it("shows fixed unlock errors, clears the password field, and supports cooldown", async () => {
    const user = userEvent.setup();
    let unlockAttempts = 0;
    vi.stubGlobal("fetch", vi.fn(async (input: string | URL | Request) => {
      if (String(input) === "/api/vault/status") return json({ configured: true, unlocked: false });
      unlockAttempts += 1;
      if (unlockAttempts === 1) return json({ error: { message: "主密码不正确", code: "INVALID_MASTER_PASSWORD" } }, 401);
      if (unlockAttempts === 2) return json({ error: { message: "尝试次数过多，请稍后再试", code: "TOO_MANY_ATTEMPTS" } }, 429);
      return json(null, 204);
    }));
    render(<VaultGate><div>受保护的工作台</div></VaultGate>);

    const password = await screen.findByLabelText("主密码");
    await user.type(password, "wrong-password-value");
    await user.click(screen.getByRole("button", { name: "解锁工作台" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("主密码不正确");
    expect(password).toHaveValue("");
    await user.type(password, "another-wrong-value");
    await user.click(screen.getByRole("button", { name: "解锁工作台" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("尝试次数过多，请稍后再试");
    expect(password).toHaveValue("");
    await user.type(password, "correct horse battery staple");
    await user.click(screen.getByRole("button", { name: "解锁工作台" }));
    expect(await screen.findByText("受保护的工作台")).toBeVisible();
  });

  it("keeps setup controls disabled during requests and surfaces status failures", async () => {
    const user = userEvent.setup();
    let resolveSetup!: (response: Response) => void;
    vi.stubGlobal("fetch", vi.fn(async (input: string | URL | Request) => {
      if (String(input) === "/api/vault/status") return json({ configured: false, unlocked: false });
      return new Promise<Response>((resolve) => { resolveSetup = resolve; });
    }));
    render(<VaultGate><div>受保护的工作台</div></VaultGate>);
    await user.type(await screen.findByLabelText("设置主密码"), "correct horse battery staple");
    await user.type(screen.getByLabelText("确认主密码"), "correct horse battery staple");
    const submit = screen.getByRole("button", { name: "设置并进入工作台" });
    await user.click(submit);
    expect(submit).toBeDisabled();
    resolveSetup(json({ error: { message: "保险库数据无法验证", code: "VAULT_INTEGRITY_ERROR" } }, 500));
    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("保险库数据无法验证"));
    expect(submit).toBeEnabled();
  });
});
