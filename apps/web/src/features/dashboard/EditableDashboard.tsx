import { useEffect, useRef, useState } from "react";
import ReactGridLayout, { type Layout } from "react-grid-layout/legacy";
import "react-grid-layout/css/styles.css";
import type { DashboardLayout } from "@workbench/contracts";
import { moduleRegistry } from "./moduleRegistry";
import { dailyQuote } from "./dailyQuotes";
import { Icon } from "../../app/Icon";

interface EditableDashboardProps {
  initialLayout: DashboardLayout[];
  onSave: (layout: DashboardLayout[]) => Promise<void>;
  now?: Date;
}

function toGridLayout(layout: DashboardLayout[], columns = 12): Layout {
  return layout.filter((item) => item.enabled).map((item) => {
    const definition = moduleRegistry[item.moduleId];
    return {
      i: item.moduleId,
      x: columns === 4 ? 0 : item.x,
      y: item.y,
      w: columns === 4 ? 4 : Math.max(item.w, definition.minW),
      h: item.h,
      minW: columns === 4 ? 4 : definition.minW,
      minH: definition.minH
    };
  });
}

export function EditableDashboard({ initialLayout, onSave, now }: EditableDashboardProps) {
  const [layout, setLayout] = useState(initialLayout);
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [gridWidth, setGridWidth] = useState(1200);
  const [currentDate, setCurrentDate] = useState(() => now ?? new Date());
  const gridContainerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (now) {
      setCurrentDate(now);
      return;
    }
    const timer = window.setInterval(() => setCurrentDate(new Date()), 60_000);
    return () => window.clearInterval(timer);
  }, [now]);

  useEffect(() => {
    const element = gridContainerRef.current;
    if (!element || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(([entry]) => setGridWidth(Math.max(280, Math.floor(entry.contentRect.width))));
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (!editing) setLayout(initialLayout);
  }, [editing, initialLayout]);

  async function finishEditing() {
    setSaving(true);
    setError(null);
    try {
      await onSave(layout);
      setEditing(false);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "工作台保存失败，请稍后重试");
    } finally {
      setSaving(false);
    }
  }

  function updateLayout(next: Layout) {
    setLayout((current) => current.map((item) => {
      const changed = next.find((candidate) => candidate.i === item.moduleId);
      return changed ? { ...item, x: changed.x, y: changed.y, w: changed.w, h: changed.h } : item;
    }));
  }

  const quote = dailyQuote(now ?? currentDate);
  const columns = gridWidth < 700 ? 4 : 16;

  return (
    <section aria-label="工作台" className="dashboard-page">
      <div className="dashboard-toolbar page-heading">
        <div className="dashboard-daily-quote"><p>{quote.text}</p><cite>——{quote.author}</cite></div>
        {editing
          ? <button className="button-primary" type="button" disabled={saving} onClick={() => void finishEditing()}><Icon name="check" size={17} />完成编辑</button>
          : <button className="button-secondary" type="button" onClick={() => { setError(null); setEditing(true); }}><Icon name="edit" size={17} />编辑工作台</button>}
      </div>
      {error && <p role="alert">{error}</p>}
      {editing && <div className="info-banner" role="status"><Icon name="grid" size={18} />拖动卡片调整位置，拖拽右下角调整大小。</div>}
      <div ref={gridContainerRef} className="dashboard-grid" data-testid="dashboard-grid" data-editable={String(editing)} data-columns={columns}>
        <ReactGridLayout
          width={gridWidth}
          cols={columns}
          rowHeight={72}
          layout={toGridLayout(layout, columns)}
          isDraggable={editing}
          isResizable={editing}
          onLayoutChange={updateLayout}
        >
          {layout.filter((item) => item.enabled).map((item) => <div key={item.moduleId} className="dashboard-module">{editing && <div className="drag-handle" aria-hidden="true">••••••</div>}{moduleRegistry[item.moduleId].render()}</div>)}
        </ReactGridLayout>
      </div>
    </section>
  );
}
