#!/usr/bin/env python
"""Run the Adecco order-hearing evaluation MVP and email the result."""

from __future__ import annotations

import argparse
import json
import os
import sys
import traceback
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Any


SCENARIO_ID = "staffing_order_hearing_adecco_manufacturer_busy_manager_medium"
SCENARIO_TITLE = "初回派遣オーダーヒアリング"
LEARNER_NAME = "アデコ営業（学習者）"
CLIENT_ROLE = "中堅住宅設備メーカーの人事課主任"
ORIGINAL_TO_ADDRESS = "iwase@zenoffice.co.jp"
SECRET_NAME = "anthropic-api-key-default"
DEFAULT_ZAPIER_ROOT = Path("C:/dev/Zapier_GCP_Migration")
DEFAULT_MAX_TOKENS = 6000
RETRY_MAX_TOKENS = 12000
DEFAULT_TEMPERATURE = 0

REQUIRED_TOP_LEVEL_KEYS = [
    "total_score",
    "rubric_scores",
    "must_capture_items",
]

ADDITIONAL_TOP_LEVEL_KEYS = [
    "schema_version",
    "session_id",
    "scenario_id",
    "score_confidence",
    "agent_quality_flags",
    "learner_feedback",
]


def parse_args() -> argparse.Namespace:
    base_dir = Path(__file__).resolve().parent
    default_transcript = base_dir / "fixtures" / "sample_transcript.json"

    parser = argparse.ArgumentParser(
        description="Run Adecco order-hearing roleplay evaluation and email Claude JSON."
    )
    parser.add_argument(
        "--transcript",
        type=Path,
        default=default_transcript,
        help="Path to transcript JSON. Defaults to bundled sample fixture.",
    )
    parser.add_argument(
        "--session-id",
        default="",
        help="Session id for the evaluation. Defaults to a generated UUID.",
    )
    parser.add_argument(
        "--zapier-root",
        type=Path,
        default=None,
        help="Path to Zapier_GCP_Migration. Overrides ZAPIER_GCP_MIGRATION_ROOT.",
    )
    return parser.parse_args()


def resolve_zapier_root(cli_root: Path | None) -> Path:
    candidates: list[Path] = []
    if cli_root:
        candidates.append(cli_root)

    env_root = os.environ.get("ZAPIER_GCP_MIGRATION_ROOT", "").strip()
    if env_root:
        candidates.append(Path(env_root))

    candidates.append(DEFAULT_ZAPIER_ROOT)
    candidates.append(Path.home() / "dev" / "Zapier_GCP_Migration")

    for candidate in candidates:
        resolved = candidate.expanduser().resolve()
        if (resolved / "src" / "functions" / "common").is_dir():
            return resolved

    searched = ", ".join(str(path) for path in candidates)
    raise FileNotFoundError(f"Zapier_GCP_Migration root not found. Searched: {searched}")


def configure_environment_and_imports(zapier_root: Path) -> None:
    os.environ.setdefault("GCP_PROJECT", "zapier-transfer")
    os.environ.setdefault("APP_ENV", "dev")
    os.environ.setdefault("INTERNAL_NOTIFICATION_EMAIL", ORIGINAL_TO_ADDRESS)
    os.environ.setdefault("GMAIL_SERVICE_ACCOUNT_FALLBACK", "true")
    os.environ.setdefault("GMAIL_DELEGATED_USER", ORIGINAL_TO_ADDRESS)

    functions_root = zapier_root / "src" / "functions"
    sys.path.insert(0, str(functions_root))


def read_text(path: Path) -> str:
    return path.read_text(encoding="utf-8")


def load_json(path: Path) -> Any:
    return json.loads(path.read_text(encoding="utf-8"))


def normalize_speaker(raw: Any) -> str:
    speaker = str(raw or "").strip().lower()
    if speaker in {"sales", "learner", "user", "営業", "学習者"}:
        return "sales"
    if speaker in {"client", "avatar", "assistant", "ai", "customer", "クライアント"}:
        return "client"
    return "unknown"


def normalize_turn(raw_turn: dict[str, Any], index: int) -> dict[str, Any]:
    turn_id = raw_turn.get("turn_id") or raw_turn.get("turnId") or raw_turn.get("id") or f"t{index:03d}"
    speaker = raw_turn.get("speaker") or raw_turn.get("role")
    text = raw_turn.get("text") or raw_turn.get("content") or raw_turn.get("message") or ""
    timestamp = (
        raw_turn.get("timestamp_sec")
        if raw_turn.get("timestamp_sec") is not None
        else raw_turn.get("relativeTimestamp", index - 1)
    )
    return {
        "turn_id": str(turn_id),
        "speaker": normalize_speaker(speaker),
        "text": str(text),
        "timestamp_sec": float(timestamp or 0),
    }


def load_transcript(path: Path) -> tuple[list[dict[str, Any]], dict[str, Any]]:
    data = load_json(path)
    metadata: dict[str, Any] = {}

    if isinstance(data, list):
        turns = data
    elif isinstance(data, dict):
        metadata = data.get("metadata") or {}
        turns = data.get("turns") or data.get("conversation_transcript") or data.get("transcript")
    else:
        raise ValueError("Transcript JSON must be an array or an object containing turns.")

    if not isinstance(turns, list) or not turns:
        raise ValueError("Transcript must contain a non-empty turns array.")

    normalized = []
    for index, turn in enumerate(turns, start=1):
        if not isinstance(turn, dict):
            raise ValueError(f"Transcript turn at index {index} must be an object.")
        normalized.append(normalize_turn(turn, index))

    return normalized, metadata


def fill_user_prompt(template: str, replacements: dict[str, str]) -> str:
    filled = template
    for key, value in replacements.items():
        filled = filled.replace("{{" + key + "}}", value)
    return filled


def extract_json_candidate(raw_text: str) -> tuple[str, str]:
    stripped = raw_text.strip()
    if stripped.startswith("```"):
        lines = stripped.splitlines()
        if lines and lines[0].strip().startswith("```"):
            lines = lines[1:]
        if lines and lines[-1].strip() == "```":
            lines = lines[:-1]
        return "\n".join(lines).strip(), "stripped markdown code fence"

    first_brace = stripped.find("{")
    last_brace = stripped.rfind("}")
    if first_brace > 0 and last_brace > first_brace:
        return stripped[first_brace : last_brace + 1], "extracted first JSON object"

    return stripped, "raw"


def validate_response_text(raw_text: str) -> tuple[bool, str, Any | None, str]:
    json_text, extraction_note = extract_json_candidate(raw_text)
    try:
        parsed = json.loads(json_text)
    except json.JSONDecodeError as exc:
        return False, f"failed: json_parse_error={exc}; extraction={extraction_note}", None, json_text

    if not isinstance(parsed, dict):
        return False, f"failed: parsed JSON is not an object; extraction={extraction_note}", parsed, json_text

    missing_required = [key for key in REQUIRED_TOP_LEVEL_KEYS if key not in parsed]
    missing_additional = [key for key in ADDITIONAL_TOP_LEVEL_KEYS if key not in parsed]

    if missing_required:
        return (
            False,
            "failed: missing required top-level keys="
            + ",".join(missing_required)
            + (
                "; missing additional keys=" + ",".join(missing_additional)
                if missing_additional
                else ""
            )
            + f"; extraction={extraction_note}",
            parsed,
            json_text,
        )

    if missing_additional:
        return (
            True,
            "success: required keys present; missing additional keys="
            + ",".join(missing_additional),
            parsed,
            json_text,
        )

    return (
        True,
        f"success: required and additional top-level keys present; extraction={extraction_note}",
        parsed,
        json_text,
    )


def build_email_body(
    *,
    session_id: str,
    transcript_path: Path,
    validation_status: str,
    validation_ok: bool,
    model: str,
    usage: dict[str, Any],
    retry_note: str,
    json_result: str,
    raw_result: str,
    parsed_result: Any | None,
    started_at: str,
    ended_at: str,
) -> str:
    total_score = None
    if isinstance(parsed_result, dict):
        total_score = parsed_result.get("total_score")

    lines = [
        "AIロープレ評価 MVP 実行結果",
        "",
        "Validation:",
        f"- ok: {validation_ok}",
        f"- status: {validation_status}",
        "",
        "Model / Usage:",
        f"- model: {model}",
        f"- usage.input_tokens: {usage.get('input_tokens', '')}",
        f"- usage.output_tokens: {usage.get('output_tokens', '')}",
        f"- retry_note: {retry_note}",
        "",
        "Session Metadata:",
        f"- session_id: {session_id}",
        f"- scenario_id: {SCENARIO_ID}",
        f"- scenario_title: {SCENARIO_TITLE}",
        f"- learner_name: {LEARNER_NAME}",
        f"- client_role: {CLIENT_ROLE}",
        f"- started_at: {started_at}",
        f"- ended_at: {ended_at}",
        f"- transcript_path: {transcript_path}",
        f"- total_score: {total_score if total_score is not None else ''}",
        "",
        "Mail Routing Intent:",
        f"- original_to_address: {ORIGINAL_TO_ADDRESS}",
        f"- internal_notification_email: {os.environ.get('INTERNAL_NOTIFICATION_EMAIL', '')}",
        f"- app_env: {os.environ.get('APP_ENV', '')}",
        "",
        "Claude Scoring JSON:",
        json_result,
    ]
    if raw_result.strip() != json_result.strip():
        lines.extend(["", "Raw Claude Response:", raw_result])
    return "\n".join(lines)


def main() -> int:
    args = parse_args()
    script_dir = Path(__file__).resolve().parent
    session_id = args.session_id.strip() or f"adecco_eval_{uuid.uuid4().hex}"

    try:
        zapier_root = resolve_zapier_root(args.zapier_root)
        configure_environment_and_imports(zapier_root)

        from common.claude_sonnet45 import call_claude_sonnet45
        from common.notification_router import get_router
        from common.secrets import get_secret

        transcript_path = args.transcript.expanduser().resolve()
        turns, transcript_metadata = load_transcript(transcript_path)

        now = datetime.now(timezone.utc).isoformat()
        started_at = str(transcript_metadata.get("started_at") or transcript_metadata.get("startedAt") or now)
        ended_at = str(transcript_metadata.get("ended_at") or transcript_metadata.get("endedAt") or now)
        transcript_source = str(transcript_metadata.get("transcript_source") or "manual_upload")
        asr_quality_note = str(
            transcript_metadata.get("asr_quality_note")
            or ("synthetic_test_transcript" if "sample_transcript" in transcript_path.name else "")
        )

        system_prompt = read_text(script_dir / "prompts" / "system.md")
        user_template = read_text(script_dir / "prompts" / "user_template.md")
        schema = load_json(script_dir / "prompts" / "schema.json")

        user_prompt = fill_user_prompt(
            user_template,
            {
                "session_id": session_id,
                "scenario_id": SCENARIO_ID,
                "scenario_title": SCENARIO_TITLE,
                "learner_name": LEARNER_NAME,
                "client_role": CLIENT_ROLE,
                "started_at": started_at,
                "ended_at": ended_at,
                "transcript_source": transcript_source,
                "asr_quality_note": asr_quality_note,
                "conversation_transcript_json": json.dumps(turns, ensure_ascii=False, indent=2),
                "optional_calibration_examples_json_or_empty_array": "[]",
            },
        )
        user_prompt = (
            user_prompt
            + "\n\n<json_output_schema>\n"
            + json.dumps(schema, ensure_ascii=False, indent=2)
            + "\n</json_output_schema>\n"
        )

        api_key = get_secret(SECRET_NAME)
        if not api_key:
            raise RuntimeError(f"Secret {SECRET_NAME} returned an empty value.")

        llm_result = call_claude_sonnet45(
            prompt=system_prompt,
            content=user_prompt,
            api_key=api_key,
            max_tokens=DEFAULT_MAX_TOKENS,
            temperature=DEFAULT_TEMPERATURE,
        )

        if llm_result.get("status") != "success":
            raise RuntimeError(f"Claude API failed: {llm_result.get('error', 'unknown error')}")

        raw_result = str(llm_result.get("result", ""))
        model = str(llm_result.get("model", ""))
        usage = llm_result.get("usage") or {}
        validation_ok, validation_status, parsed_result, json_result = validate_response_text(raw_result)
        retry_note = "not retried"

        if (
            not validation_ok
            and int(usage.get("output_tokens") or 0) >= DEFAULT_MAX_TOKENS
            and "json_parse_error" in validation_status
        ):
            retry_note = f"retried once with max_tokens={RETRY_MAX_TOKENS} after truncated JSON"
            llm_result = call_claude_sonnet45(
                prompt=system_prompt,
                content=user_prompt,
                api_key=api_key,
                max_tokens=RETRY_MAX_TOKENS,
                temperature=DEFAULT_TEMPERATURE,
            )
            if llm_result.get("status") != "success":
                raise RuntimeError(f"Claude API retry failed: {llm_result.get('error', 'unknown error')}")
            raw_result = str(llm_result.get("result", ""))
            model = str(llm_result.get("model", ""))
            usage = llm_result.get("usage") or {}
            validation_ok, validation_status, parsed_result, json_result = validate_response_text(raw_result)

        subject = f"[AIロープレ評価] {SCENARIO_ID} / {session_id}"
        body_text = build_email_body(
            session_id=session_id,
            transcript_path=transcript_path,
            validation_status=validation_status,
            validation_ok=validation_ok,
            model=model,
            usage=usage,
            retry_note=retry_note,
            json_result=json_result,
            raw_result=raw_result,
            parsed_result=parsed_result,
            started_at=started_at,
            ended_at=ended_at,
        )

        mail_result = get_router().send_email_result(
            to_address=ORIGINAL_TO_ADDRESS,
            subject=subject,
            body_text=body_text,
        )

        print(f"session_id={session_id}")
        print(f"model={model}")
        print(f"usage.input_tokens={usage.get('input_tokens', '')}")
        print(f"usage.output_tokens={usage.get('output_tokens', '')}")
        print(f"validation.ok={validation_ok}")
        print(f"validation.status={validation_status}")
        print(f"mail.routed_to={mail_result.routed_to}")
        print(f"mail.delivery={mail_result.delivery}")
        print(f"mail.ok={mail_result.ok}")
        print(f"mail.status={mail_result.status}")
        if mail_result.error:
            print(f"mail.error={mail_result.error}", file=sys.stderr)

        if not mail_result.ok:
            return 2

        return 0

    except Exception:
        traceback.print_exc(file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
