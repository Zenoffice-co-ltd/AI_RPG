"use client";

import { ChevronDown, ChevronLeft } from "lucide-react";
import { ROLEPLAY_TITLE } from "@/lib/roleplay/scenario";

export function TopBar() {
  return (
    <header className="roleplay-topbar" data-testid="roleplay-header">
      <nav className="roleplay-topbar__left" aria-label="会話ナビゲーション">
        <a className="roleplay-topbar__button" href="/" aria-label="戻る">
          <ChevronLeft size={21} strokeWidth={3} />
          <span>戻る</span>
        </a>
      </nav>

      <div className="roleplay-topbar__title" title={ROLEPLAY_TITLE}>
        {ROLEPLAY_TITLE}
      </div>

      <div className="roleplay-topbar__branch">
        <button type="button" className="roleplay-branch-button" aria-haspopup="menu">
          <span>Main</span>
          <span className="roleplay-live-badge">ライブ 100%</span>
          <ChevronDown size={16} />
        </button>
      </div>

      <div className="roleplay-topbar__right" aria-hidden="true" />
    </header>
  );
}
