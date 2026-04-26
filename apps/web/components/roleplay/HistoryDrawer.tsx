"use client";

import { X } from "lucide-react";

type HistoryItem = {
  id: string;
  title: string;
  endedAt: string;
  turns: number;
};

export function HistoryDrawer({
  open,
  items,
  onClose,
}: {
  open: boolean;
  items: HistoryItem[];
  onClose: () => void;
}) {
  if (!open) {
    return null;
  }

  return (
    <aside className="history-drawer" aria-label="会話履歴">
      <button
        type="button"
        className="history-drawer__close"
        onClick={onClose}
        aria-label="履歴を閉じる"
      >
        <X size={20} />
      </button>
      <h2>履歴</h2>
      {items.length === 0 ? (
        <p>保存された会話はありません。</p>
      ) : (
        <ul>
          {items.map((item) => (
            <li key={item.id}>
              <strong>{item.title}</strong>
              <span>
                {new Date(item.endedAt).toLocaleString("ja-JP")} / {item.turns}件
              </span>
            </li>
          ))}
        </ul>
      )}
    </aside>
  );
}
