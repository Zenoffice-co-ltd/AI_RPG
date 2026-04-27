"use client";

import { Plus } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { MessageList } from "./MessageList";
import { Composer } from "./Composer";
import type {
  RoleplayMode,
  RoleplayStatus,
  TranscriptMessage,
} from "@/lib/roleplay/conversation-types";

export function TranscriptPanel({
  mode,
  state,
  messages,
  error,
  limitWarning,
  onSend,
  onRetry,
  onNewConversation,
}: {
  mode: RoleplayMode;
  state: RoleplayStatus;
  messages: TranscriptMessage[];
  error: string | null;
  limitWarning: boolean;
  onSend: (text: string) => Promise<void>;
  onRetry: (message: TranscriptMessage) => void;
  onNewConversation: () => void;
}) {
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const [atBottom, setAtBottom] = useState(true);

  useEffect(() => {
    if (atBottom) {
      scrollToBottom();
    }
  }, [messages, atBottom]);

  function scrollToBottom() {
    const node = scrollRef.current;
    if (!node) {
      return;
    }
    node.scrollTop = node.scrollHeight;
  }

  function handleScroll() {
    const node = scrollRef.current;
    if (!node) {
      return;
    }
    setAtBottom(node.scrollHeight - node.scrollTop - node.clientHeight < 80);
  }

  return (
    <aside className="transcript-panel" data-testid="right-transcript-panel">
      <div ref={scrollRef} className="transcript-scroll" onScroll={handleScroll}>
        <div className="transcript-status">{statusText(state, mode)}</div>
        <MessageList messages={messages} onRetry={onRetry} />
        {state === "ended" ? (
          <div className="transcript-ended">
            <p>通話を終了しました</p>
            <div className="transcript-ended__actions">
              <button type="button" onClick={onNewConversation}>
                <Plus size={22} />
                <span>新しい会話</span>
              </button>
            </div>
          </div>
        ) : null}
        {limitWarning ? (
          <p className="transcript-warning">まもなく最大通話時間に達します。</p>
        ) : null}
        {error ? <p className="transcript-error">{error}</p> : null}
      </div>
      <Composer onSend={onSend} />
    </aside>
  );
}

function statusText(state: RoleplayStatus, mode: RoleplayMode) {
  if (state === "connecting") {
    return "接続中です";
  }
  if (state === "ended") {
    return mode === "mock" || mode === "visualTest"
      ? "通話が開始されました"
      : "通話が終了しました";
  }
  if (state === "error") {
    return "接続に失敗しました";
  }
  if (state === "idle") {
    return "チャットを開始するにはメッセージを送信してください";
  }
  return "通話が開始されました";
}
