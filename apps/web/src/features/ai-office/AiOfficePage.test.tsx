import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";
import type { SurfaceLayoutItem } from "@workbench/contracts";
import { AiOfficePage } from "./AiOfficePage";

describe("AiOfficePage", () => {
  it("creates a stable default card layout and preserves disabled tool coordinates for restoration", () => {
    const saved: SurfaceLayoutItem[] = [{ itemId: "polish", surface: "ai-office", x: 9, y: 3, w: 5, h: 4, enabled: false }];
    render(<MemoryRouter><AiOfficePage initialLayout={saved} tools={[{ id: "chat", label: "聊天", path: "/chat", icon: "sparkles", description: "聊天" }, { id: "polish", label: "润色", path: "/polish", icon: "edit", description: "润色" }]} /></MemoryRouter>);

    expect(screen.getByRole("link", { name: "聊天" })).toBeVisible();
    expect(screen.queryByRole("link", { name: "润色" })).not.toBeInTheDocument();
    expect(screen.getByTestId("ai-office-grid")).toHaveAttribute("data-item-count", "2");
  });

  it("saves tool layouts when editing finishes", async () => {
    const user = userEvent.setup();
    const onSave = vi.fn().mockResolvedValue(undefined);
    render(<MemoryRouter><AiOfficePage onSave={onSave} tools={[{ id: "chat", label: "聊天", path: "/chat", icon: "sparkles", description: "聊天" }]} /></MemoryRouter>);

    await user.click(screen.getByRole("button", { name: "编辑工具" }));
    await user.click(screen.getByRole("button", { name: "完成编辑" }));
    expect(onSave).toHaveBeenCalledWith([expect.objectContaining({ itemId: "chat", surface: "ai-office" })]);
  });
});
