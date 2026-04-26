"use client";

import { X } from "lucide-react";

export function VoiceSettingsDialog({
  open,
  devices,
  selectedInput,
  muted,
  volume,
  onClose,
  onMute,
  onVolume,
  onInput,
}: {
  open: boolean;
  devices: MediaDeviceInfo[];
  selectedInput: string;
  muted: boolean;
  volume: number;
  onClose: () => void;
  onMute: () => void | Promise<void>;
  onVolume: (volume: number) => void;
  onInput: (deviceId: string) => void | Promise<void>;
}) {
  if (!open) {
    return null;
  }

  return (
    <div className="roleplay-modal" role="dialog" aria-modal="true" aria-label="ボイス設定">
      <section className="roleplay-modal__panel">
        <button
          type="button"
          className="roleplay-modal__close"
          onClick={onClose}
          aria-label="ボイス設定を閉じる"
        >
          <X size={20} />
        </button>
        <h2>ボイス設定</h2>
        <label>
          マイク
          <select
            value={selectedInput}
            onChange={(event) => {
              void onInput(event.target.value);
            }}
          >
            <option value="">既定のマイク</option>
            {devices.map((device) => (
              <option key={device.deviceId} value={device.deviceId}>
                {device.label || "マイクデバイス"}
              </option>
            ))}
          </select>
        </label>
        <label className="roleplay-modal__toggle">
          <input
            type="checkbox"
            checked={muted}
            onChange={() => {
              void onMute();
            }}
          />
          ミュート
        </label>
        <label>
          音量
          <input
            type="range"
            min="0"
            max="1"
            step="0.01"
            value={volume}
            onChange={(event) => onVolume(Number(event.target.value))}
          />
        </label>
      </section>
    </div>
  );
}
