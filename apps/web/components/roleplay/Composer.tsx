"use client";

import { ArrowUp } from "lucide-react";
import { useState } from "react";
import { canSendMessage } from "@/lib/roleplay/transcript";

export function Composer({ onSend }: { onSend: (text: string) => Promise<void> }) {
  const [value, setValue] = useState("");
  const [pending, setPending] = useState(false);

  async function submit() {
    if (!canSendMessage(value) || pending) {
      return;
    }
    const text = value;
    setPending(true);
    try {
      await onSend(text);
      setValue("");
    } finally {
      setPending(false);
    }
  }

  return (
    <form
      className="composer"
      data-testid="composer"
      onSubmit={(event) => {
        event.preventDefault();
        void submit();
      }}
    >
      <textarea
        value={value}
        placeholder="チャットを開始するにはメッセージを送信してください"
        aria-label="メッセージを送信"
        onChange={(event) => setValue(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Enter" && !event.shiftKey) {
            event.preventDefault();
            void submit();
          }
        }}
      />
      <button
        type="submit"
        className="composer__send"
        disabled={!canSendMessage(value) || pending}
        aria-label="送信"
      >
        <ArrowUp size={30} strokeWidth={3} />
      </button>
    </form>
  );
}
