import { act, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { SurfaceLayoutItem } from "@workbench/contracts";
import { EditableSurfaceGrid } from "./EditableSurfaceGrid";

const items: SurfaceLayoutItem[] = [{ itemId: "ai-chat", surface: "ai-office", x: 8, y: 2, w: 6, h: 4, enabled: true }];

describe("EditableSurfaceGrid", () => {
  it("emits edited desktop coordinates and preserves them on a narrow screen", () => {
    let resize: (width: number) => void = () => undefined;
    class TestResizeObserver implements ResizeObserver {
      constructor(callback: ResizeObserverCallback) {
        resize = (width) => callback([{ contentRect: { width } } as ResizeObserverEntry], this);
      }
      observe() {}
      unobserve() {}
      disconnect() {}
    }
    vi.stubGlobal("ResizeObserver", TestResizeObserver);
    const onLayoutChange = vi.fn();
    render(<EditableSurfaceGrid surface="ai-office" items={items} editing onLayoutChange={onLayoutChange} renderItem={(item) => <span>{item.itemId}</span>} />);

    expect(screen.getByTestId("surface-grid")).toHaveAttribute("data-columns", "16");
    const callsBeforeMobile = onLayoutChange.mock.calls.length;
    act(() => resize(600));
    expect(screen.getByTestId("surface-grid")).toHaveAttribute("data-columns", "4");
    expect(screen.getByText("ai-chat")).toBeVisible();
    expect(onLayoutChange).toHaveBeenCalledTimes(callsBeforeMobile);
  });
});
