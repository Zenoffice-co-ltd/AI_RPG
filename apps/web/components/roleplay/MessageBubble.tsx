"use client";

import type { TranscriptMessage } from "@/lib/roleplay/conversation-types";

export function MessageBubble({
  message,
  onRetry,
}: {
  message: TranscriptMessage;
  onRetry?: (message: TranscriptMessage) => void;
}) {
  if (message.role === "system") {
    return <div className="message-row message-row--system">{message.text}</div>;
  }

  if (message.role === "user") {
    return (
      <div className="message-row message-row--user">
        <span>{message.text}</span>
        {message.status === "sending" ? (
          <span className="message-status">送信中</span>
        ) : null}
        {message.status === "failed" ? (
          <button
            type="button"
            className="message-retry"
            onClick={() => onRetry?.(message)}
          >
            再送
          </button>
        ) : null}
      </div>
    );
  }

  const slowIndex = message.text.indexOf(" [slow]");
  const text = slowIndex >= 0 ? message.text.slice(0, slowIndex) : message.text;
  const slow = slowIndex >= 0;

  return (
    <div className="message-row message-row--agent">
      <span className="agent-avatar" aria-hidden="true" />
      <p>
        {text}
        {slow ? <span className="message-slow">[slow]</span> : null}
      </p>
    </div>
  );
}
