"use client";

import { ROLEPLAY_TITLE } from "@/lib/roleplay/scenario";

export function TopBar() {
  return (
    <header className="roleplay-topbar" data-testid="roleplay-header">
      <nav className="roleplay-topbar__left" aria-label="会話ナビゲーション">
        <a className="roleplay-topbar__logo" href="https://mendan.biz/" aria-label="MENDAN">
          MENDAN
        </a>
      </nav>

      <div className="roleplay-topbar__title" title={ROLEPLAY_TITLE}>
        {ROLEPLAY_TITLE}
      </div>

      <div className="roleplay-topbar__branch">
        <div className="roleplay-branch-button" aria-label="Main ライブ 100%">
          <span>Main</span>
          <span className="roleplay-live-badge">ライブ 100%</span>
        </div>
      </div>

      <div className="roleplay-topbar__right" aria-hidden="true" />
    </header>
  );
}
