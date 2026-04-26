"use client";

import { MessageBubble } from "./MessageBubble";
import type { TranscriptMessage } from "@/lib/roleplay/conversation-types";

export function MessageList({
  messages,
  onRetry,
}: {
  messages: TranscriptMessage[];
  onRetry?: (message: TranscriptMessage) => void;
}) {
  return (
    <div className="message-list" data-testid="message-list">
      {messages.map((message) => (
        <MessageBubble
          key={message.id}
          message={message}
          {...(onRetry ? { onRetry } : {})}
        />
      ))}
    </div>
  );
}
