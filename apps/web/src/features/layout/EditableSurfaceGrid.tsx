import { useEffect, useRef, useState, type ReactNode } from "react";
import ReactGridLayout, { type Layout } from "react-grid-layout/legacy";
import "react-grid-layout/css/styles.css";
import "react-resizable/css/styles.css";
import type { SurfaceId, SurfaceLayoutItem } from "@workbench/contracts";

export interface EditableSurfaceGridProps {
  surface: SurfaceId;
  items: SurfaceLayoutItem[];
  renderItem: (item: SurfaceLayoutItem) => ReactNode;
  editing: boolean;
  onLayoutChange: (items: SurfaceLayoutItem[]) => void;
  testId?: string;
  className?: string;
}

function gridLayout(items: SurfaceLayoutItem[], columns: number): Layout {
  return items.filter((item) => item.enabled).map((item) => ({
    i: item.itemId,
    x: columns === 4 ? 0 : item.x,
    y: item.y,
    w: columns === 4 ? 4 : item.w,
    h: item.h,
    minW: columns === 4 ? 4 : 1,
    minH: 1
  }));
}

export function EditableSurfaceGrid({ surface, items, renderItem, editing, onLayoutChange, testId = "surface-grid", className }: EditableSurfaceGridProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(1200);
  const columns = width < 700 ? 4 : 16;

  useEffect(() => {
    const element = containerRef.current;
    if (!element || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(([entry]) => setWidth(Math.max(280, Math.floor(entry.contentRect.width))));
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  function updateLayout(next: Layout) {
    if (columns === 4) return;
    onLayoutChange(items.map((item) => {
      const changed = next.find((candidate) => candidate.i === item.itemId);
      return changed ? { ...item, x: changed.x, y: changed.y, w: changed.w, h: changed.h } : item;
    }));
  }

  return <div ref={containerRef} className={`editable-surface-grid${className ? ` ${className}` : ""}`} data-testid={testId} data-surface={surface} data-columns={columns} data-editable={String(editing)}>
    <ReactGridLayout width={width} cols={columns} rowHeight={72} margin={[16, 16]} containerPadding={[0, 0]} autoSize layout={gridLayout(items, columns)} compactType="vertical" preventCollision={false} isBounded isDraggable={editing} isResizable={editing} draggableHandle=".drag-handle" onDragStop={updateLayout} onResizeStop={updateLayout}>
      {items.filter((item) => item.enabled).map((item) => <div key={item.itemId} className="surface-grid-item"><div className="surface-grid-content">{editing && <button type="button" className="drag-handle" aria-label="拖动卡片">••••••</button>}{renderItem(item)}</div></div>)}
    </ReactGridLayout>
  </div>;
}
