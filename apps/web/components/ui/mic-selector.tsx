"use client";

export function MicSelector({
  devices,
  value,
  onChange,
}: {
  devices: MediaDeviceInfo[];
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <select value={value} onChange={(event) => onChange(event.target.value)}>
      <option value="">既定のマイク</option>
      {devices.map((device) => (
        <option key={device.deviceId} value={device.deviceId}>
          {device.label || "マイクデバイス"}
        </option>
      ))}
    </select>
  );
}
