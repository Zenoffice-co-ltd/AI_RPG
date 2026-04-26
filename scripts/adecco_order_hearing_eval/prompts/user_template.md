<task>
以下のAIロープレ会話ログを評価してください。
評価は system prompt のルーブリックに厳密に従ってください。
</task>

<session_metadata>
{
  "session_id": "{{session_id}}",
  "scenario_id": "{{scenario_id}}",
  "scenario_title": "{{scenario_title}}",
  "learner_name": "{{learner_name}}",
  "client_role": "{{client_role}}",
  "started_at": "{{started_at}}",
  "ended_at": "{{ended_at}}",
  "transcript_source": "{{transcript_source}}",
  "asr_quality_note": "{{asr_quality_note}}"
}
</session_metadata>

<conversation_transcript>
{{conversation_transcript_json}}
</conversation_transcript>

<conversation_transcript_format>
conversation_transcript_json は以下の形式です。

[
  {
    "turn_id": "t001",
    "speaker": "client",
    "text": "お時間ありがとうございます...",
    "timestamp_sec": 0.0
  },
  {
    "turn_id": "t002",
    "speaker": "sales",
    "text": "本日はありがとうございます...",
    "timestamp_sec": 8.5
  }
]
</conversation_transcript_format>

<optional_calibration_examples>
{{optional_calibration_examples_json_or_empty_array}}
</optional_calibration_examples>

<final_instruction>
会話ログのみを根拠に採点し、指定されたJSON形式だけを返してください。
</final_instruction>
