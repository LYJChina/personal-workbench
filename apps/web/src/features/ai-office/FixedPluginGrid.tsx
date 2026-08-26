import { useRef } from "react";
import { Link } from "react-router-dom";
import { Icon, type IconName } from "../../app/Icon";

const supportedIcons: IconName[] = ["home", "sparkles", "bell", "lock", "settings", "edit", "arrow", "user", "copy", "file", "palette", "mail", "check", "grid", "clock"];

function iconName(value: string): IconName {
  return supportedIcons.includes(value as IconName) ? value as IconName : "grid";
}

export interface AiOfficeCard {
  pluginId: string;
  label: string;
  description: string;
  path: string;
  icon: string;
}

interface FixedPluginGridProps {
  items: AiOfficeCard[];
  editing: boolean;
  onMove: (from: number, to: number) => void;
  onRemove: (pluginId: string) => void;
}

export function FixedPluginGrid({ items, editing, onMove, onRemove }: FixedPluginGridProps) {
  const draggedIndex = useRef<number | null>(null);

  function startDrag(index: number) {
    draggedIndex.current = index;
  }

  function finishDrop(index: number) {
    const from = draggedIndex.current;
    draggedIndex.current = null;
    if (from === null || from === index) return;
    onMove(from, index);
  }

  return (
    <ul className="ai-fixed-grid" aria-label="AI 办公工具列表">
      {items.map((item, index) => (
        <li
          className={`ai-fixed-card${editing ? " editing" : ""}`}
          draggable={editing}
          key={item.pluginId}
          onDragStart={() => startDrag(index)}
          onDragEnd={() => {
            draggedIndex.current = null;
          }}
          onDragOver={(event) => {
            if (!editing) return;
            event.preventDefault();
          }}
          onDrop={(event) => {
            if (!editing) return;
            event.preventDefault();
            finishDrop(index);
          }}
        >
          {editing ? (
            <div className="ai-fixed-card-shell">
              <div className="ai-fixed-card-main">
                <span className="tool-icon">
                  <Icon name={iconName(item.icon)} size={24} />
                </span>
                <span className="tool-content">
                  <strong>{item.label}</strong>
                  <span>{item.description}</span>
                </span>
              </div>
              <div className="ai-fixed-card-actions">
                <button className="button-secondary compact" type="button" disabled={index === 0} onClick={() => onMove(index, index - 1)}>
                  {`上移 ${item.label}`}
                </button>
                <button className="button-secondary compact" type="button" disabled={index === items.length - 1} onClick={() => onMove(index, index + 1)}>
                  {`下移 ${item.label}`}
                </button>
                <button className="button-secondary compact" type="button" onClick={() => onRemove(item.pluginId)}>
                  {`移出 AI 办公 ${item.label}`}
                </button>
              </div>
            </div>
          ) : (
            <Link aria-label={item.label} className="ai-tool-card ai-fixed-card-shell" to={item.path}>
              <span className="tool-icon">
                <Icon name={iconName(item.icon)} size={24} />
              </span>
              <span className="tool-content">
                <strong>{item.label}</strong>
                <span>{item.description}</span>
              </span>
              <span className="tool-arrow">
                进入 <span aria-hidden="true">→</span>
              </span>
            </Link>
          )}
        </li>
      ))}
    </ul>
  );
}
