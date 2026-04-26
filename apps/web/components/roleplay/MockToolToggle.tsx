"use client";

export function MockToolToggle({
  enabled,
  onToggle,
}: {
  enabled: boolean;
  onToggle: () => void;
}) {
  return (
    <button type="button" className="roleplay-mock-pill" onClick={onToggle}>
      {enabled ? "オン" : "オフ"}
    </button>
  );
}
