import { useEffect, useState } from "react";
import ReactGridLayout, { type Layout } from "react-grid-layout/legacy";
import "react-grid-layout/css/styles.css";
import type { DashboardLayout } from "@workbench/contracts";
import { moduleRegistry } from "./moduleRegistry";

interface EditableDashboardProps {
  initialLayout: DashboardLayout[];
  onSave: (layout: DashboardLayout[]) => Promise<void>;
}

function toGridLayout(layout: DashboardLayout[]): Layout {
  return layout.filter((item) => item.enabled).map((item) => ({
    i: item.moduleId,
    x: item.x,
    y: item.y,
    w: item.w,
    h: item.h,
    minW: moduleRegistry[item.moduleId].minW,
    minH: moduleRegistry[item.moduleId].minH
  }));
}

export function EditableDashboard({ initialLayout, onSave }: EditableDashboardProps) {
  const [layout, setLayout] = useState(initialLayout);
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

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
    <section aria-label="工作台">
      <div className="dashboard-toolbar">
        <h2>我的主页</h2>
        {editing
          ? <button type="button" disabled={saving} onClick={() => void finishEditing()}>完成编辑</button>
          : <button type="button" onClick={() => { setError(null); setEditing(true); }}>编辑工作台</button>}
      </div>
      {error && <p role="alert">{error}</p>}
      <div data-testid="dashboard-grid" data-editable={String(editing)}>
        <ReactGridLayout
          width={1200}
          cols={12}
          rowHeight={72}
          layout={toGridLayout(layout)}
          isDraggable={editing}
          isResizable={editing}
          onLayoutChange={updateLayout}
        >
          {layout.filter((item) => item.enabled).map((item) => <div key={item.moduleId} className="dashboard-module">{moduleRegistry[item.moduleId].render()}</div>)}
        </ReactGridLayout>
      </div>
    </section>
  );
}
