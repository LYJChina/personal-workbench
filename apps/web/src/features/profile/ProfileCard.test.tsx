import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ProfileCard } from "./ProfileCard";

const emptyProfile = {
  name: "",
  birthday: "",
  employeeNumber: "",
  customFields: [],
  photoFilename: null
};

describe("ProfileCard", () => {
  it("sends edited personal information to its save boundary", async () => {
    const onSave = vi.fn().mockResolvedValue(undefined);
    render(<ProfileCard initialProfile={emptyProfile} onSave={onSave} />);

    fireEvent.click(screen.getByRole("button", { name: "编辑个人信息" }));
    fireEvent.change(screen.getByLabelText("姓名"), { target: { value: "李雨佳" } });
    fireEvent.change(screen.getByLabelText("员工编号"), { target: { value: "LYJ-001" } });
    fireEvent.click(screen.getByRole("button", { name: "保存" }));

    await waitFor(() => {
      expect(onSave).toHaveBeenCalledWith(expect.objectContaining({ name: "李雨佳", employeeNumber: "LYJ-001" }));
    });
  });

  it("retains entered values and displays feedback when saving fails", async () => {
    const onSave = vi.fn().mockRejectedValue(new Error("保存失败"));
    render(<ProfileCard initialProfile={emptyProfile} onSave={onSave} />);

    fireEvent.click(screen.getByRole("button", { name: "编辑个人信息" }));
    fireEvent.change(screen.getByLabelText("姓名"), { target: { value: "李雨佳" } });
    fireEvent.change(screen.getByLabelText("员工编号"), { target: { value: "LYJ-001" } });
    fireEvent.click(screen.getByRole("button", { name: "保存" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("保存失败");
    expect(screen.getByLabelText("姓名")).toHaveValue("李雨佳");
  });

  it("shows a field error and blocks saving when a custom-field label is blank", () => {
    const onSave = vi.fn().mockResolvedValue(undefined);
    render(<ProfileCard initialProfile={{ ...emptyProfile, name: "李雨佳", employeeNumber: "LYJ-001" }} onSave={onSave} />);

    fireEvent.click(screen.getByRole("button", { name: "编辑个人信息" }));
    fireEvent.click(screen.getByRole("button", { name: "添加自定义信息" }));
    fireEvent.click(screen.getByRole("button", { name: "保存" }));

    expect(screen.getByRole("alert")).toHaveTextContent("请输入自定义信息标签");
    expect(screen.getByLabelText("标签")).toHaveAttribute("aria-invalid", "true");
    expect(onSave).not.toHaveBeenCalled();
  });

  it("displays a profile loaded after the card first renders", () => {
    const onSave = vi.fn().mockResolvedValue(undefined);
    const { rerender } = render(<ProfileCard initialProfile={emptyProfile} onSave={onSave} />);

    rerender(<ProfileCard initialProfile={{ ...emptyProfile, name: "李雨佳", employeeNumber: "LYJ-001" }} onSave={onSave} />);

    expect(screen.getByText("姓名：李雨佳")).toBeVisible();
    expect(screen.getByText("员工编号：LYJ-001")).toBeVisible();
  });
});
