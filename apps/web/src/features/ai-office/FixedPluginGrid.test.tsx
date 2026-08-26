import { fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";
import { FixedPluginGrid, type AiOfficeCard } from "./FixedPluginGrid";

const items: AiOfficeCard[] = [
  {
    pluginId: "lyj.system.ai-polish",
    label: "AI 润色",
    description: "润色文字",
    path: "/ai-office/polish",
    icon: "sparkles"
  },
  {
    pluginId: "lyj.system.daily-reports",
    label: "日报生成",
    description: "整理日报",
    path: "/ai-office/daily-report",
    icon: "file"
  }
];

describe("FixedPluginGrid", () => {
  it("renders a semantic fixed card list without free-grid affordances in normal mode", () => {
    render(
      <MemoryRouter>
        <FixedPluginGrid items={items} editing={false} onMove={vi.fn()} onRemove={vi.fn()} />
      </MemoryRouter>
    );

    expect(screen.getByRole("list")).toHaveClass("ai-fixed-grid");
    expect(screen.getAllByRole("listitem")).toHaveLength(2);
    expect(screen.getByRole("link", { name: "AI 润色" })).toHaveAttribute("href", "/ai-office/polish");
    expect(document.querySelector(".react-grid-layout")).toBeNull();
    expect(document.querySelector(".react-resizable-handle")).toBeNull();
  });

  it("supports drag reorder, keyboard reorder, and removal in edit mode", () => {
    const onMove = vi.fn();
    const onRemove = vi.fn();
    render(
      <MemoryRouter>
        <FixedPluginGrid items={items} editing onMove={onMove} onRemove={onRemove} />
      </MemoryRouter>
    );

    const cards = screen.getAllByRole("listitem");
    const dataTransfer = {
      effectAllowed: "move",
      setData: vi.fn(),
      getData: vi.fn()
    } as unknown as DataTransfer;

    fireEvent.dragStart(cards[0], { dataTransfer });
    fireEvent.dragOver(cards[1], { dataTransfer });
    fireEvent.drop(cards[1], { dataTransfer });
    expect(onMove).toHaveBeenCalledWith(0, 1);

    fireEvent.click(screen.getByRole("button", { name: "上移 日报生成" }));
    expect(onMove).toHaveBeenCalledWith(1, 0);

    fireEvent.click(screen.getByRole("button", { name: "移出 AI 办公 AI 润色" }));
    expect(onRemove).toHaveBeenCalledWith("lyj.system.ai-polish");
  });
});
