import { useEffect, useRef, useState } from "react";
import ReactGridLayout, { type Layout } from "react-grid-layout/legacy";
import "react-grid-layout/css/styles.css";
import type { DashboardLayout } from "@workbench/contracts";
import { moduleRegistry } from "./moduleRegistry";
import { Icon } from "../../app/Icon";

interface EditableDashboardProps {
  initialLayout: DashboardLayout[];
  onSave: (layout: DashboardLayout[]) => Promise<void>;
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

export function EditableDashboard({ initialLayout, onSave }: EditableDashboardProps) {
  const [layout, setLayout] = useState(initialLayout);
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [gridWidth, setGridWidth] = useState(1200);
  const gridContainerRef = useRef<HTMLDivElement>(null);

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

  return (
    <section aria-label="工作台" className="dashboard-page">
      <div className="dashboard-toolbar page-heading">
        <div><span className="eyebrow">PERSONAL SPACE</span><h2>我的主页</h2><p>下午好，今天也稳稳地把事情做好。</p></div>
        {editing
          ? <button className="button-primary" type="button" disabled={saving} onClick={() => void finishEditing()}><Icon name="check" size={17} />完成编辑</button>
          : <button className="button-secondary" type="button" onClick={() => { setError(null); setEditing(true); }}><Icon name="edit" size={17} />编辑工作台</button>}
      </div>
      {error && <p role="alert">{error}</p>}
      {editing && <div className="info-banner" role="status"><Icon name="grid" size={18} />拖动卡片调整位置，拖拽右下角调整大小。</div>}
      <div ref={gridContainerRef} className="dashboard-grid" data-testid="dashboard-grid" data-editable={String(editing)}>
        <ReactGridLayout
          width={gridWidth}
          cols={gridWidth < 700 ? 4 : 12}
          rowHeight={72}
          layout={toGridLayout(layout, gridWidth < 700 ? 4 : 12)}
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
