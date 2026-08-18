import { useEffect, useState } from "react";
import type { NavigationItem } from "@workbench/contracts";

interface SidebarEditorProps {
  initialItems: NavigationItem[];
  onSave: (items: NavigationItem[]) => Promise<void>;
  onClose?: () => void;
}

function normalize(items: NavigationItem[]): NavigationItem[] {
  return items.map((item, position) => ({ ...item, position, disabled: item.id === "vault-coming-soon" ? true : item.disabled }));
}

export function SidebarEditor({ initialItems, onSave, onClose }: SidebarEditorProps) {
  const [items, setItems] = useState(() => normalize([...initialItems].sort((a, b) => a.position - b.position)));
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => setItems(normalize([...initialItems].sort((a, b) => a.position - b.position))), [initialItems]);

  function update(id: NavigationItem["id"], change: Partial<NavigationItem>) {
    setItems((current) => normalize(current.map((item) => item.id === id ? { ...item, ...change } : item)));
  }

  function move(id: NavigationItem["id"], direction: -1 | 1) {
    setItems((current) => {
      const index = current.findIndex((item) => item.id === id);
      const target = index + direction;
      if (index < 0 || target < 0 || target >= current.length) return current;
      const next = [...current];
      [next[index], next[target]] = [next[target], next[index]];
      return normalize(next);
    });
  }

  async function save() {
    setSaving(true);
    setError(null);
    try {
      await onSave(normalize(items));
      onClose?.();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "导航保存失败，请稍后重试");
    } finally {
      setSaving(false);
    }
  }

  return (
    <section aria-label="编辑导航">
      <h2>编辑导航</h2>
      {error && <p role="alert">{error}</p>}
      <ul className="sidebar-editor-list">
        {items.map((item, index) => (
          <li key={item.id}>
            <span>{item.label}</span>
            <button type="button" aria-label={`上移 ${item.label}`} disabled={index === 0} onClick={() => move(item.id, -1)}>上移</button>
            <button type="button" aria-label={`下移 ${item.label}`} disabled={index === items.length - 1} onClick={() => move(item.id, 1)}>下移</button>
            <button type="button" aria-label={`${item.visible ? "隐藏" : "恢复"} ${item.label}`} onClick={() => update(item.id, { visible: !item.visible })}>{item.visible ? "隐藏" : "恢复"}</button>
          </li>
        ))}
      </ul>
      <button type="button" disabled={saving} onClick={() => void save()}>保存导航</button>
      {onClose && <button type="button" onClick={onClose}>取消</button>}
    </section>
  );
}
