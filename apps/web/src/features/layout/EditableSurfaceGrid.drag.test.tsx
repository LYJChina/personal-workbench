import type { ComponentProps, ReactNode } from "react";
import { render } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type ReactGridLayout from "react-grid-layout/legacy";
import type { SurfaceLayoutItem } from "@workbench/contracts";

const captured = vi.hoisted(() => ({ props: null as ComponentProps<typeof ReactGridLayout> | null }));

vi.mock("react-grid-layout/legacy", () => ({
  default: (props: ComponentProps<typeof ReactGridLayout>) => {
    captured.props = props;
    return <div>{props.children as ReactNode}</div>;
  }
}));

import { EditableSurfaceGrid } from "./EditableSurfaceGrid";

const items: SurfaceLayoutItem[] = [{ itemId: "ai-chat", surface: "ai-office", x: 0, y: 0, w: 8, h: 4, enabled: true }];

describe("EditableSurfaceGrid drag configuration", () => {
  it("allows dragging from the card surface while protecting interactive controls", () => {
    render(<EditableSurfaceGrid surface="ai-office" items={items} editing onLayoutChange={vi.fn()} renderItem={() => <button type="button">卡片按钮</button>} />);

    expect(captured.props?.draggableHandle).toBeUndefined();
    expect(captured.props?.draggableCancel).toContain("button:not(.drag-handle)");
    expect(captured.props?.draggableCancel).toContain("input");
    expect(captured.props?.isDraggable).toBe(true);
  });
});
