import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import {
  JA_VOICE_RESCUE_PREVIEW_TEXT,
  JA_VOICE_RESCUE_PROMPTS,
} from "../../packages/scenario-engine/src/jaVoiceVariations";
import { getAppContext } from "../../apps/web/server/appContext";

function getArg(flag: string) {
  const index = process.argv.findIndex((value) => value === flag);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

function getArgs(flag: string) {
  const values: string[] = [];
  for (let index = 0; index < process.argv.length; index += 1) {
    if (process.argv[index] === flag && process.argv[index + 1]) {
      values.push(process.argv[index + 1]!);
    }
  }
  return values;
}

async function main() {
  const slots =
    getArgs("--slot").length > 0
      ? (getArgs("--slot") as Array<keyof typeof JA_VOICE_RESCUE_PROMPTS>)
      : (["R01", "R02", "R03"] as Array<keyof typeof JA_VOICE_RESCUE_PROMPTS>);
  const outputDir =
    getArg("--output-dir") ??
    resolve(
      "data",
      "generated",
      "voice-benchmark",
      "ja-rescue-voices",
      new Date().toISOString().replaceAll(":", "-")
    );
  const selectPreview = getArg("--select-preview");
  const voiceName = getArg("--voice-name");
  const createVoice = ["true", "1", "yes", "y"].includes(
    (getArg("--create") ?? "").toLowerCase()
  );
  const ctx = getAppContext();

  await mkdir(outputDir, { recursive: true });
  const manifest = [];
  for (const slot of slots) {
    const designed = await ctx.vendors.elevenLabs.designVoicePreviews({
      voiceDescription: JA_VOICE_RESCUE_PROMPTS[slot],
      modelId: "eleven_ttv_v3",
      text: JA_VOICE_RESCUE_PREVIEW_TEXT,
      autoGenerateText: false,
      shouldEnhance: false,
      ...(getArg("--seed") ? { seed: Number(getArg("--seed")) } : {}),
    });

    const previewDir = resolve(outputDir, slot.toLowerCase());
    await mkdir(previewDir, { recursive: true });
    for (const [index, preview] of designed.previews.entries()) {
      if (preview.audio_base_64) {
        await writeFile(
          resolve(previewDir, `preview_${index + 1}.mp3`),
          Buffer.from(preview.audio_base_64, "base64")
        );
      }
    }

    let createdVoice:
      | {
          voiceId: string;
          name: string | null | undefined;
        }
      | undefined;
    if (createVoice) {
      if (slots.length !== 1) {
        throw new Error("--create only supports a single --slot at a time.");
      }
      if (!selectPreview || !voiceName) {
        throw new Error("--create requires --select-preview and --voice-name.");
      }
      const selected = designed.previews[Number(selectPreview) - 1];
      if (!selected) {
        throw new Error(`Preview index out of range for ${slot}: ${selectPreview}`);
      }
      const created = await ctx.vendors.elevenLabs.createVoiceFromPreview({
        voiceName,
        voiceDescription: JA_VOICE_RESCUE_PROMPTS[slot],
        generatedVoiceId: selected.generated_voice_id,
        labels: {
          accent: "Japanese",
          gender: slot === "R02" ? "male" : "female",
          use_case: "business_conversation",
        },
      });
      createdVoice = {
        voiceId: created.voice_id,
        name: created.name,
      };
    }

    manifest.push({
      slot,
      prompt: JA_VOICE_RESCUE_PROMPTS[slot],
      previewText: JA_VOICE_RESCUE_PREVIEW_TEXT,
      previews: designed.previews.map((preview: (typeof designed.previews)[number], index: number) => ({
        index: index + 1,
        generatedVoiceId: preview.generated_voice_id,
        mediaType: preview.media_type,
        durationSecs: preview.duration_secs,
        language: preview.language,
        audioFile: preview.audio_base_64
          ? resolve(previewDir, `preview_${index + 1}.mp3`)
          : undefined,
      })),
      ...(createdVoice ? { createdVoice } : {}),
    });
  }

  const manifestPath = resolve(outputDir, "manifest.json");
  await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
  console.info(JSON.stringify({ outputDir, manifestPath, slots }, null, 2));
}

void main();
