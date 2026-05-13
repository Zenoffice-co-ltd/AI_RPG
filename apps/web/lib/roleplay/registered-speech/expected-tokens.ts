import type { CanonicalIntent } from "./canonical-intents";
import type { ExpectedTokenRequirement } from "./types";

// Per-intent ASR validation contract. For each intent:
//   - `primary`: every entry must appear as a substring in the ASR text.
//     These are content words the artifact MUST contain regardless of
//     how the STT normalizer renders numerals / particles.
//   - `alternates`: each inner array is an OR — at least one of its
//     entries must appear. Use for terms the STT may collapse, e.g.
//     "せんななひゃくごじゅう円" / "1750円" / "1,750円".
//
// First-build calibration: the `alternates` lists below are seeded with
// our best guess for GCP STT v2's Japanese normalizer. On the first
// build run the human reviewer reads the artifact's `asrText` field and
// adjusts these lists to match actual STT output. Final pronunciation
// guarantee comes from the audio sha256 + human approval, NOT from
// expected-token coverage.
export const EXPECTED_TOKENS_BY_INTENT: Record<
  CanonicalIntent,
  ExpectedTokenRequirement
> = {
  mission: {
    primary: ["派遣"],
    alternates: [["人事課", "じんじ課"]],
  },
  engagement_scope: {
    primary: ["営業事務", "相談"],
    alternates: [],
  },
  job_content: {
    primary: ["納期", "営業事務"],
    // Haruto rebuild (2026-05-12): "じゅはっちゅう" kana sounded
    // unnatural so the source was rewritten to "受注や発注". The
    // alternates accept either the new split form or the legacy
    // "受発注" kanji string an STT model might still emit.
    alternates: [["受注", "受発注", "じゅはっちゅう"], ["発注", "受発注", "じゅはっちゅう"]],
  },
  start_date: {
    primary: [],
    alternates: [["六月ついたち", "六月一日", "6月1日", "六月１日"]],
  },
  order_volume: {
    primary: [],
    alternates: [
      ["つきあたり", "月あたり", "月当たり"],
      ["ろっぴゃく件", "六百件", "600件"],
      ["ななひゃっけん", "七百件", "700件"],
    ],
  },
  busy_period: {
    primary: ["月曜日"],
    // 2026-05-12 A/B verdict: A read 月のおわり/月の初め correctly but
    // sounded too informal; B read 月末/月初 with the wrong reading
    // (つきすえ / つきはじめ) and was rejected. New spokenText forces
    // the business reading via kana ("げつまつとげっしょ"). Alternates
    // accept any of the four phrasings the STT might produce.
    alternates: [
      ["げつまつ", "月末", "月のおわり"],
      ["げっしょ", "月初", "月のはじめ", "月の初め"],
    ],
  },
  hiring_reason: {
    primary: ["増員", "受注処理"],
    alternates: [],
  },
  ack_short: {
    primary: ["はい"],
    alternates: [],
  },
  skill_followup_teamwork: {
    primary: ["連携"],
    alternates: [["営業", "営業や物流"]],
  },
  skill_requirement_broad: {
    primary: ["経験", "優先"],
    // Haruto rebuild (2026-05-12): "じゅはっちゅう" kana sounded
    // unnatural so the source was rewritten to "受注や発注の経験".
    alternates: [["受注", "受発注", "じゅはっちゅう"], ["発注", "受発注", "じゅはっちゅう"]],
  },
  skill_requirement_short_01: {
    primary: ["受発注", "経験"],
    alternates: [],
  },
  manufacturer_experience_optional: {
    primary: ["必須", "受発注"],
    alternates: [["メーカー", "業界"]],
  },
  personality: {
    primary: ["合いやすく", "合いにくい"],
    alternates: [],
  },
  billing_rate: {
    primary: ["請求想定", "経験"],
    alternates: [
      ["せんななひゃくごじゅう円", "千七百五十円", "1750円", "1,750円"],
      ["せんきゅうひゃく円", "千九百円", "1900円", "1,900円"],
    ],
  },
  decision_maker: {
    primary: ["最終判断", "現場課長"],
    alternates: [["じんじ", "人事"]],
  },
  decision_maker_short_01: {
    primary: ["決裁者", "人事課長"],
    alternates: [],
  },
  wednesday_followup: {
    primary: ["お願いします", "アデコ"],
    alternates: [["たしゃ", "他社"]],
  },
  closing_short: {
    primary: ["よろしくお願いします"],
    alternates: [],
  },
  working_hours: {
    primary: ["平日"],
    alternates: [
      ["朝八時よんじゅうごふん", "朝8時45分", "朝八時四十五分"],
      ["夕方五時三十分", "夕方5時30分", "夕方17時30分"],
    ],
  },
  overtime: {
    primary: ["残業"],
    alternates: [
      [
        "つきじゅうからじゅうごじかん",
        "月10から15時間",
        "月十から十五時間",
        "10から15時間",
      ],
    ],
  },
  remote_work: {
    primary: ["在宅", "当面"],
    alternates: [],
  },
  headcount: {
    primary: ["営業事務", "一名"],
    alternates: [],
  },
  greeting: {
    // Greeting expected tokens are populated at build time from the
    // current firstMessageJa string. The build script reads the scenario
    // bundle and inlines them here via a generator step.
    primary: [],
    alternates: [],
  },
  multi_intent_redirect: {
    primary: ["一つずつ", "業務内容"],
    alternates: [],
  },
  fallback_unknown: {
    primary: ["求人要件"],
    alternates: [],
  },
  fallback_business_low_confidence_01: {
    primary: ["明確"],
    alternates: [],
  },
  fallback_business_low_confidence_02: {
    primary: ["現時点"],
    alternates: [],
  },
  fallback_business_low_confidence_03: {
    primary: ["具体化"],
    alternates: [],
  },
  fallback_rapid_fire_01: {
    primary: ["項目", "範囲"],
    alternates: [],
  },
  fallback_rapid_fire_02: {
    primary: ["内容", "絞ります"],
    alternates: [],
  },
  fallback_rapid_fire_short_01: {
    primary: ["要点", "絞ります"],
    alternates: [],
  },
  fallback_out_of_scope_01: {
    primary: ["採用要件"],
    alternates: [],
  },
  fallback_out_of_scope_02: {
    primary: ["確認"],
    alternates: [],
  },
  fallback_safety_01: {
    primary: ["答え"],
    alternates: [],
  },
  fallback_safety_02: {
    primary: ["開示"],
    alternates: [],
  },
  fallback_unknown_01: {
    primary: ["判断"],
    alternates: [],
  },
  fallback_pr92_unknown_01: {
    primary: ["確認"],
    alternates: [],
  },
  fallback_audio_not_ready: {
    primary: ["音声", "準備"],
    alternates: [],
  },
};

export function checkExpectedTokens(
  intent: CanonicalIntent,
  asrText: string
): { matched: string[]; missing: string[] } {
  const req = EXPECTED_TOKENS_BY_INTENT[intent];
  const matched: string[] = [];
  const missing: string[] = [];

  for (const token of req.primary) {
    if (asrText.includes(token)) {
      matched.push(token);
    } else {
      missing.push(token);
    }
  }
  for (const group of req.alternates) {
    const hit = group.find((alt) => asrText.includes(alt));
    if (hit) {
      matched.push(hit);
    } else {
      missing.push(group.join(" | "));
    }
  }
  return { matched, missing };
}
