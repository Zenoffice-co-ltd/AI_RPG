export function nowMs(): number {
  return Date.now();
}

export function estimatePcmDurationMs(input: {
  bytes: number;
  sampleRateHz: number;
  channels?: number;
  bytesPerSample?: number;
}): number {
  const channels = input.channels ?? 1;
  const bytesPerSample = input.bytesPerSample ?? 2;
  if (input.bytes <= 0 || input.sampleRateHz <= 0) {
    return 0;
  }
  const bytesPerSecond = input.sampleRateHz * channels * bytesPerSample;
  if (bytesPerSecond <= 0) {
    return 0;
  }
  return Math.round((input.bytes / bytesPerSecond) * 1000);
}

export function wrapPcmS16LeAsWav(input: {
  pcm: Buffer;
  sampleRateHz: number;
  channels?: number;
}): Buffer {
  const channels = input.channels ?? 1;
  const bytesPerSample = 2;
  const byteRate = input.sampleRateHz * channels * bytesPerSample;
  const blockAlign = channels * bytesPerSample;
  const dataSize = input.pcm.length;
  const fmtChunkSize = 16;
  const riffSize = 4 + (8 + fmtChunkSize) + (8 + dataSize);

  const header = Buffer.alloc(44);
  header.write("RIFF", 0, "ascii");
  header.writeUInt32LE(riffSize, 4);
  header.write("WAVE", 8, "ascii");

  header.write("fmt ", 12, "ascii");
  header.writeUInt32LE(fmtChunkSize, 16);
  header.writeUInt16LE(1, 20); // PCM
  header.writeUInt16LE(channels, 22);
  header.writeUInt32LE(input.sampleRateHz, 24);
  header.writeUInt32LE(byteRate, 28);
  header.writeUInt16LE(blockAlign, 32);
  header.writeUInt16LE(bytesPerSample * 8, 34);

  header.write("data", 36, "ascii");
  header.writeUInt32LE(dataSize, 40);

  return Buffer.concat([header, input.pcm], header.length + dataSize);
}
