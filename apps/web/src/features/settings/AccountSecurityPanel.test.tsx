import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { AccountSecurityPanel } from "./AccountSecurityPanel";

describe("AccountSecurityPanel", () => {
  it("shows sanitized recovery state and changes the master password", async () => {
    const user = userEvent.setup();
    const changePassword = vi.fn(async () => undefined);
    render(<AccountSecurityPanel api={{
      getVaultRecoveryStatus: async () => ({ state: "active", maskedEmail: "o***@example.com", smtpHealth: "valid", checkedAt: null }),
      changeVaultPassword: changePassword
    }} />);
    expect(await screen.findByText("o***@example.com")).toBeVisible();
    await user.type(screen.getByLabelText("当前主密码"), "current-master-password");
    await user.type(screen.getByLabelText("新主密码"), "replacement-master-password");
    await user.type(screen.getByLabelText("确认新主密码"), "replacement-master-password");
    await user.click(screen.getByRole("button", { name: "修改主密码" }));
    expect(changePassword).toHaveBeenCalledWith("current-master-password", "replacement-master-password");
    expect(screen.getByLabelText("当前主密码")).toHaveValue("");
  });
});
