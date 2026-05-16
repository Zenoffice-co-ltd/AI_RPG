import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

const root = process.cwd();
const expected = stringArg("expect", process.env.VFINAL_SUBMISSION_DOD_EXPECT ?? "auto");
const allowedExpected = new Set(["auto", "blocked", "pass"]);
if (!allowedExpected.has(expected)) {
  console.error(`Invalid --expect value: ${expected}. Use auto, blocked, or pass.`);
  process.exit(1);
}

const files = {
  closeout: join(root, "docs", "security", "adecco-ai-roleplay-final-security-closeout.md"),
  audit: join(root, "docs", "security", "adecco-vfinal-customer-submission-dod-audit.md"),
  questionnaireMap: join(root, "docs", "security", "adecco-vfinal-questionnaire-submission-map.md"),
  approvalPacket: join(root, "docs", "security", "adecco-vfinal-approval-packet.md"),
};

const failures = [];
const source = {};
for (const [name, path] of Object.entries(files)) {
  if (!existsSync(path)) {
    failures.push(`missing ${name}: ${path}`);
    continue;
  }
  source[name] = readFileSync(path, "utf8");
}

const closeoutVerdict = matchOne(
  source.closeout,
  /Customer submission DoD:\s*\r?\n\s*(PASS|BLOCKED)\b/,
  "closeout Customer submission DoD verdict"
);
const auditStatus = matchOne(
  source.audit,
  /^Status as of .*?: \*\*(PASS|BLOCKED)\b.*?\*\*\./m,
  "audit top-level status"
);
const questionnaireMapStatus = matchOne(
  source.questionnaireMap,
  /^Status as of .*?: \*\*(PASS|BLOCKED)\b.*?\*\*\./m,
  "questionnaire map top-level status"
);

const normalizedExpected =
  expected === "auto" ? closeoutVerdict?.toLowerCase() : expected;

if (normalizedExpected === "blocked") {
  requireEqual(closeoutVerdict, "BLOCKED", "closeout verdict");
  requireEqual(auditStatus, "BLOCKED", "audit status");
  requireEqual(questionnaireMapStatus, "BLOCKED", "questionnaire map status");
  requireIncludes(
    source.approvalPacket,
    "approval required before customer submission",
    "approval packet should remain approval-required while DoD is blocked"
  );
  requireIncludes(
    source.audit,
    "| 25 | Closeout Final Verdict is `Customer submission DoD: PASS` | BLOCKED |",
    "audit row 25 should block final PASS"
  );
  for (const issue of ["#138", "#139", "#140", "#141"]) {
    requireIncludes(source.closeout, `Issue ${issue}`, `closeout remaining blocker ${issue}`);
    requireIncludes(source.audit, issue, `audit blocker ${issue}`);
    requireIncludes(source.questionnaireMap, issue, `questionnaire map blocker ${issue}`);
  }
}

if (normalizedExpected === "pass") {
  requireEqual(closeoutVerdict, "PASS", "closeout verdict");
  requireEqual(auditStatus, "PASS", "audit status");
  requireEqual(questionnaireMapStatus, "PASS", "questionnaire map status");
  rejectIncludes(source.closeout, "Remaining blockers:", "closeout should not list blockers after PASS");
  rejectIncludes(source.audit, "Customer submission remains blocked", "audit should not say blocked after PASS");
  rejectIncludes(
    source.questionnaireMap,
    "BLOCKED for customer submission DoD",
    "questionnaire map should not say blocked after PASS"
  );
}

if (failures.length > 0) {
  console.error("vFinal customer submission DoD status check FAILED");
  for (const failure of failures) {
    console.error(`- ${failure}`);
  }
  process.exit(1);
}

console.log(
  JSON.stringify(
    {
      status: "PASS",
      expected: normalizedExpected,
      closeoutVerdict,
      auditStatus,
      questionnaireMapStatus,
      blockers: normalizedExpected === "blocked" ? ["#138", "#139", "#140", "#141"] : [],
    },
    null,
    2
  )
);

function matchOne(text, regex, label) {
  if (typeof text !== "string") return null;
  const match = regex.exec(text);
  if (!match) {
    failures.push(`missing ${label}`);
    return null;
  }
  return match[1];
}

function requireEqual(actual, expectedValue, label) {
  if (actual !== expectedValue) {
    failures.push(`${label}: expected ${expectedValue}, got ${actual ?? "missing"}`);
  }
}

function requireIncludes(text, needle, label) {
  if (typeof text !== "string" || !text.includes(needle)) {
    failures.push(`missing ${label}`);
  }
}

function rejectIncludes(text, needle, label) {
  if (typeof text === "string" && text.includes(needle)) {
    failures.push(label);
  }
}

function stringArg(name, fallback) {
  const prefix = `--${name}=`;
  const arg = process.argv.find((value) => value.startsWith(prefix));
  return arg ? arg.slice(prefix.length) : fallback;
}
