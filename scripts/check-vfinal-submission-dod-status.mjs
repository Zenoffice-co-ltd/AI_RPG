import { existsSync, readFileSync } from "node:fs";
import { extname, join } from "node:path";
import { spawnSync } from "node:child_process";
import { inflateRawSync } from "node:zlib";

const root = process.cwd();
const expected = stringArg("expect", process.env.VFINAL_SUBMISSION_DOD_EXPECT ?? "auto");
const workbookPaths = [
  ...listArgs("workbook"),
  ...envList("VFINAL_SUBMISSION_DOD_WORKBOOKS"),
];
const shouldCheckGithubIssues =
  boolArg("check-github-issues") || process.env.VFINAL_SUBMISSION_DOD_CHECK_GITHUB_ISSUES === "1";
const allowOpenApprovedIssues =
  boolArg("allow-open-approved-issues") ||
  process.env.VFINAL_SUBMISSION_DOD_ALLOW_OPEN_APPROVED_ISSUES === "1";
const approvalAuthors = [
  ...listArgs("approval-author"),
  ...envList("VFINAL_SUBMISSION_DOD_APPROVAL_AUTHORS"),
];
const requiredIssues = [138, 139, 140, 141, 171];
const issueApprovalNeedles = new Map([
  [
    138,
    [
      "Approved: the dedicated hosted.app URL is acceptable as the vFinal customer",
      "submitted URL.",
    ],
  ],
  [
    139,
    [
      "Approved: the vFinal customer-submitted runtime scope is limited to the",
      "dedicated no-key App Hosting backend adecco-roleplay-vfinal and its submitted URL.",
      "Legacy shared App Hosting routes and their XAI_API_KEY access are internal",
      "out of scope for the vFinal customer submission.",
    ],
  ],
  [
    140,
    [
      "Approved: use the following pre-vFinal latency baseline for the vFinal customer submission comparison.",
      "Baseline source:",
      "pre-vFinal sessions >=20",
      "sessionApiMs p95",
      "firstAudioDeltaMs p95",
      "firstAudibleAudioMs p95",
      "Comparison result: PASS",
    ],
  ],
  [
    141,
    [
      "Approved: the current verify:acceptance blocker is a legacy ConvAI vendor judge",
      "blocker outside the vFinal submitted runtime/security scope.",
      "outside the customer submission DoD.",
    ],
  ],
  [
    171,
    [
      "Approved: all cells listed in",
      "docs/security/adecco-vfinal-workbook-human-confirmation-cell-map.md",
      "have been human-confirmed or rewritten to explicit unresolved/not-applicable answers",
      "the questionnaire drafts may be treated as final submission artifacts.",
    ],
  ],
]);
if (boolArg("self-test")) {
  runSelfTest();
  process.exit(0);
}
const allowedExpected = new Set(["auto", "blocked", "pass"]);
if (!allowedExpected.has(expected)) {
  console.error(`Invalid --expect value: ${expected}. Use auto, blocked, or pass.`);
  process.exit(1);
}

const files = {
  closeout: join(root, "docs", "security", "adecco-ai-roleplay-final-security-closeout.md"),
  deliveryStatus: join(root, "docs", "DELIVERY_STATUS.md"),
  audit: join(root, "docs", "security", "adecco-vfinal-customer-submission-dod-audit.md"),
  questionnaireMap: join(root, "docs", "security", "adecco-vfinal-questionnaire-submission-map.md"),
  approvalPacket: join(root, "docs", "security", "adecco-vfinal-approval-packet.md"),
  workbookHumanConfirmationMap: join(
    root,
    "docs",
    "security",
    "adecco-vfinal-workbook-human-confirmation-cell-map.md"
  ),
  blockerInventoryIndex: join(
    root,
    "docs",
    "security",
    "adecco-vfinal-blocker-inventory-index.md"
  ),
  submittedUrlDecisionInventory: join(
    root,
    "docs",
    "security",
    "adecco-vfinal-submitted-url-decision-inventory.md"
  ),
  legacyXaiScopeInventory: join(
    root,
    "docs",
    "security",
    "adecco-vfinal-legacy-xai-scope-inventory.md"
  ),
  latencyBaselineAssessment: join(
    root,
    "docs",
    "security",
    "adecco-vfinal-latency-baseline-candidate-assessment.md"
  ),
  acceptanceBlockerInventory: join(
    root,
    "docs",
    "security",
    "adecco-vfinal-acceptance-blocker-inventory.md"
  ),
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
const securityChecksheetVerdict = matchOne(
  source.closeout,
  /Security-checksheet submission DoD:\s*\r?\n\s*(PASS|BLOCKED)\b/,
  "closeout Security-checksheet submission DoD verdict"
);
const deliveryStatus = matchOne(
  source.deliveryStatus,
  /^Status as of .*?: \*\*(PASS|BLOCKED)\b.*?\*\*\./m,
  "delivery status vFinal top-level status"
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
const workbookHumanConfirmationMapStatus = matchWorkbookHumanConfirmationMapStatus();
const submittedUrlDecisionInventoryStatus = matchSubmittedUrlDecisionInventoryStatus();
const legacyXaiScopeInventoryStatus = matchLegacyXaiScopeInventoryStatus();
const latencyBaselineAssessmentStatus = matchLatencyBaselineAssessmentStatus();
const acceptanceBlockerInventoryStatus = matchAcceptanceBlockerInventoryStatus();
const blockerInventoryIndexStatus = matchBlockerInventoryIndexStatus();

const normalizedExpected =
  expected === "auto" ? closeoutVerdict?.toLowerCase() : expected;

if (normalizedExpected === "blocked") {
  requireEqual(closeoutVerdict, "BLOCKED", "closeout verdict");
  requireEqual(securityChecksheetVerdict, "BLOCKED", "security-checksheet verdict");
  requireEqual(deliveryStatus, "BLOCKED", "delivery status");
  requireEqual(auditStatus, "BLOCKED", "audit status");
  requireEqual(questionnaireMapStatus, "BLOCKED", "questionnaire map status");
  requireEqual(workbookHumanConfirmationMapStatus, "BLOCKED", "workbook human confirmation map status");
  requireEqual(submittedUrlDecisionInventoryStatus, "BLOCKED", "submitted URL decision inventory status");
  requireEqual(legacyXaiScopeInventoryStatus, "BLOCKED", "legacy XAI scope inventory status");
  requireEqual(latencyBaselineAssessmentStatus, "BLOCKED", "latency baseline assessment status");
  requireEqual(acceptanceBlockerInventoryStatus, "BLOCKED", "acceptance blocker inventory status");
  requireEqual(blockerInventoryIndexStatus, "BLOCKED", "blocker inventory index status");
  requireIncludes(
    source.workbookHumanConfirmationMap,
    "human confirmation still required before final questionnaire submission",
    "workbook human confirmation map blocked status"
  );
  for (const workbookMarker of [
    "Adecco_データ保護アンケート_v01_回答ドラフト.xlsx",
    "Adecco_TPISAアンケート_v01_回答ドラフト.xlsm",
    "`Sheet1` | `E5`",
    "`基本情報` | `C12`",
    "`A.組織のセキュリティ` | `G15`",
    "`B.製品のセキュリティ` | `G39:G40`",
  ]) {
    requireIncludes(
      source.workbookHumanConfirmationMap,
      workbookMarker,
      `workbook human confirmation map marker ${workbookMarker}`
    );
  }
  for (const [surfaceName, surface] of [
    ["closeout", source.closeout],
    ["audit", source.audit],
    ["questionnaire map", source.questionnaireMap],
    ["approval packet", source.approvalPacket],
  ]) {
    requireIncludes(
      surface,
      "docs/security/adecco-vfinal-workbook-human-confirmation-cell-map.md",
      `${surfaceName} workbook human confirmation map link`
    );
  }
  requireIncludes(
    source.blockerInventoryIndex,
    "all blocker inventories still require resolution or approval",
    "blocker inventory index blocked status"
  );
  for (const linkedDoc of [
    "docs/security/adecco-vfinal-submitted-url-decision-inventory.md",
    "docs/security/adecco-vfinal-legacy-xai-scope-inventory.md",
    "docs/security/adecco-vfinal-latency-baseline-candidate-assessment.md",
    "docs/security/adecco-vfinal-acceptance-blocker-inventory.md",
    "docs/security/adecco-vfinal-workbook-human-confirmation-cell-map.md",
  ]) {
    requireIncludes(source.blockerInventoryIndex, linkedDoc, `blocker inventory index link ${linkedDoc}`);
  }
  for (const [surfaceName, surface] of [
    ["closeout", source.closeout],
    ["audit", source.audit],
    ["questionnaire map", source.questionnaireMap],
    ["approval packet", source.approvalPacket],
  ]) {
    requireIncludes(
      surface,
      "docs/security/adecco-vfinal-blocker-inventory-index.md",
      `${surfaceName} blocker inventory index link`
    );
  }
  requireIncludes(
    source.submittedUrlDecisionInventory,
    "submitted URL approval or custom domain mapping still required",
    "submitted URL decision inventory blocked status"
  );
  requireIncludes(
    source.closeout,
    "docs/security/adecco-vfinal-submitted-url-decision-inventory.md",
    "closeout #138 submitted URL decision inventory link"
  );
  requireIncludes(
    source.audit,
    "docs/security/adecco-vfinal-submitted-url-decision-inventory.md",
    "audit #138 submitted URL decision inventory link"
  );
  requireIncludes(
    source.questionnaireMap,
    "docs/security/adecco-vfinal-submitted-url-decision-inventory.md",
    "questionnaire map #138 submitted URL decision inventory link"
  );
  requireIncludes(
    source.approvalPacket,
    "docs/security/adecco-vfinal-submitted-url-decision-inventory.md",
    "approval packet #138 submitted URL decision inventory link"
  );
  requireIncludes(
    source.legacyXaiScopeInventory,
    "legacy shared XAI_API_KEY scope decision still required",
    "legacy XAI scope inventory blocked status"
  );
  requireIncludes(
    source.closeout,
    "docs/security/adecco-vfinal-legacy-xai-scope-inventory.md",
    "closeout #139 legacy XAI scope inventory link"
  );
  requireIncludes(
    source.audit,
    "docs/security/adecco-vfinal-legacy-xai-scope-inventory.md",
    "audit #139 legacy XAI scope inventory link"
  );
  requireIncludes(
    source.questionnaireMap,
    "docs/security/adecco-vfinal-legacy-xai-scope-inventory.md",
    "questionnaire map #139 legacy XAI scope inventory link"
  );
  requireIncludes(
    source.approvalPacket,
    "docs/security/adecco-vfinal-legacy-xai-scope-inventory.md",
    "approval packet #139 legacy XAI scope inventory link"
  );
  requireIncludes(
    source.latencyBaselineAssessment,
    "no approved strict pre-vFinal baseline found",
    "latency baseline assessment blocked status"
  );
  requireIncludes(
    source.closeout,
    "docs/security/adecco-vfinal-latency-baseline-candidate-assessment.md",
    "closeout #140 latency assessment link"
  );
  requireIncludes(
    source.audit,
    "docs/security/adecco-vfinal-latency-baseline-candidate-assessment.md",
    "audit #140 latency assessment link"
  );
  requireIncludes(
    source.questionnaireMap,
    "docs/security/adecco-vfinal-latency-baseline-candidate-assessment.md",
    "questionnaire map #140 latency assessment link"
  );
  requireIncludes(
    source.approvalPacket,
    "docs/security/adecco-vfinal-latency-baseline-candidate-assessment.md",
    "approval packet #140 latency assessment link"
  );
  requireIncludes(
    source.acceptanceBlockerInventory,
    "acceptance PASS or explicit legacy blocker approval still required",
    "acceptance blocker inventory blocked status"
  );
  requireIncludes(
    source.closeout,
    "docs/security/adecco-vfinal-acceptance-blocker-inventory.md",
    "closeout #141 acceptance blocker inventory link"
  );
  requireIncludes(
    source.audit,
    "docs/security/adecco-vfinal-acceptance-blocker-inventory.md",
    "audit #141 acceptance blocker inventory link"
  );
  requireIncludes(
    source.questionnaireMap,
    "docs/security/adecco-vfinal-acceptance-blocker-inventory.md",
    "questionnaire map #141 acceptance blocker inventory link"
  );
  requireIncludes(
    source.approvalPacket,
    "docs/security/adecco-vfinal-acceptance-blocker-inventory.md",
    "approval packet #141 acceptance blocker inventory link"
  );
  requireIncludes(
    source.questionnaireMap,
    "security-checksheet submission DoD",
    "questionnaire map security-checksheet blocked status"
  );
  requireIncludes(
    source.approvalPacket,
    "approval required before customer submission",
    "approval packet should remain approval-required while DoD is blocked"
  );
  requireIncludes(
    source.audit,
    "| 25 | Closeout Final Verdict is `Customer submission DoD: PASS` and security-checksheet submission verdict is PASS | BLOCKED |",
    "audit row 25 should block final PASS"
  );
  for (const issue of ["#138", "#139", "#140", "#141", "#171"]) {
    requireIncludes(source.closeout, `Issue ${issue}`, `closeout remaining blocker ${issue}`);
    requireIncludes(source.deliveryStatus, issue, `delivery status blocker ${issue}`);
    requireIncludes(source.audit, issue, `audit blocker ${issue}`);
    requireIncludes(source.questionnaireMap, issue, `questionnaire map blocker ${issue}`);
  }
  requireIncludes(
    source.deliveryStatus,
    "corepack pnpm grok:vfinal-submission-dod-status -- --expect=pass",
    "delivery status final PASS guard"
  );
  requireIncludes(
    source.deliveryStatus,
    "security-checksheet submission DoD",
    "delivery status security-checksheet verdict"
  );
}

if (normalizedExpected === "pass") {
  requireEqual(closeoutVerdict, "PASS", "closeout verdict");
  requireEqual(securityChecksheetVerdict, "PASS", "security-checksheet verdict");
  requireEqual(deliveryStatus, "PASS", "delivery status");
  requireEqual(auditStatus, "PASS", "audit status");
  requireEqual(questionnaireMapStatus, "PASS", "questionnaire map status");
  requireEqual(workbookHumanConfirmationMapStatus, "PASS", "workbook human confirmation map status");
  requireEqual(submittedUrlDecisionInventoryStatus, "PASS", "submitted URL decision inventory status");
  requireEqual(legacyXaiScopeInventoryStatus, "PASS", "legacy XAI scope inventory status");
  requireEqual(latencyBaselineAssessmentStatus, "PASS", "latency baseline assessment status");
  requireEqual(acceptanceBlockerInventoryStatus, "PASS", "acceptance blocker inventory status");
  requireEqual(blockerInventoryIndexStatus, "PASS", "blocker inventory index status");
  rejectIncludes(source.closeout, "Remaining blockers:", "closeout should not list blockers after PASS");
  rejectIncludes(source.deliveryStatus, "BLOCKED for customer submission DoD", "delivery status should not say blocked after PASS");
  rejectIncludes(source.deliveryStatus, "#138", "delivery status should not list #138 after PASS");
  rejectIncludes(source.deliveryStatus, "#139", "delivery status should not list #139 after PASS");
  rejectIncludes(source.deliveryStatus, "#140", "delivery status should not list #140 after PASS");
  rejectIncludes(source.deliveryStatus, "#141", "delivery status should not list #141 after PASS");
  rejectIncludes(source.deliveryStatus, "#171", "delivery status should not list #171 after PASS");
  rejectIncludes(source.audit, "Customer submission remains blocked", "audit should not say blocked after PASS");
  rejectIncludes(
    source.workbookHumanConfirmationMap,
    "human confirmation still required before final questionnaire submission",
    "workbook human confirmation map should not say human confirmation is still required after PASS"
  );
  rejectIncludes(
    source.blockerInventoryIndex,
    "all blocker inventories still require resolution or approval",
    "blocker inventory index should not say resolution/approval required after PASS"
  );
  rejectIncludes(
    source.blockerInventoryIndex,
    "BLOCKED:",
    "blocker inventory index should not list BLOCKED rows after PASS"
  );
  rejectIncludes(
    source.submittedUrlDecisionInventory,
    "submitted URL approval or custom domain mapping still required",
    "submitted URL decision inventory should not say approval/mapping required after PASS"
  );
  rejectIncludes(
    source.submittedUrlDecisionInventory,
    "Issue #138 remains blocked",
    "submitted URL decision inventory should not say #138 remains blocked after PASS"
  );
  rejectIncludes(
    source.legacyXaiScopeInventory,
    "legacy shared XAI_API_KEY scope decision still required",
    "legacy XAI scope inventory should not say scope decision required after PASS"
  );
  rejectIncludes(
    source.legacyXaiScopeInventory,
    "Issue #139 remains blocked",
    "legacy XAI scope inventory should not say #139 remains blocked after PASS"
  );
  rejectIncludes(
    source.latencyBaselineAssessment,
    "no approved strict pre-vFinal baseline found",
    "latency baseline assessment should not say no approved strict baseline after PASS"
  );
  rejectIncludes(
    source.latencyBaselineAssessment,
    "Issue #140 remains blocked",
    "latency baseline assessment should not say #140 remains blocked after PASS"
  );
  rejectIncludes(
    source.acceptanceBlockerInventory,
    "acceptance PASS or explicit legacy blocker approval still required",
    "acceptance blocker inventory should not say acceptance approval required after PASS"
  );
  rejectIncludes(
    source.acceptanceBlockerInventory,
    "Issue #141 remains blocked",
    "acceptance blocker inventory should not say #141 remains blocked after PASS"
  );
  rejectIncludes(
    source.audit,
    "Customer submission and security-checksheet submission remain blocked",
    "audit should not say customer/security-checksheet blocked after PASS"
  );
  rejectIncludes(
    source.audit,
    "security-checksheet submission remain blocked",
    "audit should not say security-checksheet blocked after PASS"
  );
  rejectIncludes(
    source.questionnaireMap,
    "BLOCKED for customer submission DoD",
    "questionnaire map should not say blocked after PASS"
  );
  rejectIncludes(
    source.questionnaireMap,
    "BLOCKED for customer submission DoD and security-checksheet submission DoD",
    "questionnaire map should not say security-checksheet blocked after PASS"
  );
}

const workbookResults = workbookPaths.map((path) =>
  checkWorkbook(path, normalizedExpected)
);
const githubIssues = shouldCheckGithubIssues
  ? checkGithubIssues(normalizedExpected)
  : [];

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
      securityChecksheetVerdict,
      deliveryStatus,
      auditStatus,
      questionnaireMapStatus,
      workbookHumanConfirmationMapStatus,
      submittedUrlDecisionInventoryStatus,
      legacyXaiScopeInventoryStatus,
      latencyBaselineAssessmentStatus,
      acceptanceBlockerInventoryStatus,
      blockerInventoryIndexStatus,
      blockers: normalizedExpected === "blocked" ? ["#138", "#139", "#140", "#141", "#171"] : [],
      workbooks: workbookResults,
      githubIssues,
    },
    null,
    2
  )
);

function matchSubmittedUrlDecisionInventoryStatus() {
  const text = source.submittedUrlDecisionInventory;
  if (typeof text !== "string") return null;
  if (/^Status as of .*?: \*\*PASS\b.*?\*\*\./m.test(text)) return "PASS";
  if (/^Status as of .*?: \*\*submitted URL approval or custom domain mapping still required\*\*\./m.test(text)) {
    return "BLOCKED";
  }
  failures.push(
    "submitted URL decision inventory status must be PASS or submitted URL approval or custom domain mapping still required"
  );
  return null;
}

function matchWorkbookHumanConfirmationMapStatus() {
  const text = source.workbookHumanConfirmationMap;
  if (typeof text !== "string") return null;
  if (/^Status as of .*?: \*\*PASS\b.*?\*\*\./m.test(text)) return "PASS";
  if (/^Status as of .*?: \*\*human confirmation still required before final questionnaire submission\*\*\./m.test(text)) {
    return "BLOCKED";
  }
  failures.push(
    "workbook human confirmation map status must be PASS or human confirmation still required before final questionnaire submission"
  );
  return null;
}

function matchLegacyXaiScopeInventoryStatus() {
  const text = source.legacyXaiScopeInventory;
  if (typeof text !== "string") return null;
  if (/^Status as of .*?: \*\*PASS\b.*?\*\*\./m.test(text)) return "PASS";
  if (/^Status as of .*?: \*\*legacy shared XAI_API_KEY scope decision still required\*\*\./m.test(text)) {
    return "BLOCKED";
  }
  failures.push(
    "legacy XAI scope inventory status must be PASS or legacy shared XAI_API_KEY scope decision still required"
  );
  return null;
}

function matchLatencyBaselineAssessmentStatus() {
  const text = source.latencyBaselineAssessment;
  if (typeof text !== "string") return null;
  if (/^Status as of .*?: \*\*PASS\b.*?\*\*\./m.test(text)) return "PASS";
  if (/^Status as of .*?: \*\*no approved strict pre-vFinal baseline found\*\*\./m.test(text)) {
    return "BLOCKED";
  }
  failures.push(
    "latency baseline assessment status must be PASS or no approved strict pre-vFinal baseline found"
  );
  return null;
}

function matchAcceptanceBlockerInventoryStatus() {
  const text = source.acceptanceBlockerInventory;
  if (typeof text !== "string") return null;
  if (/^Status as of .*?: \*\*PASS\b.*?\*\*\./m.test(text)) return "PASS";
  if (/^Status as of .*?: \*\*acceptance PASS or explicit legacy blocker approval still required\*\*\./m.test(text)) {
    return "BLOCKED";
  }
  failures.push(
    "acceptance blocker inventory status must be PASS or acceptance PASS or explicit legacy blocker approval still required"
  );
  return null;
}

function matchBlockerInventoryIndexStatus() {
  const text = source.blockerInventoryIndex;
  if (typeof text !== "string") return null;
  if (/^Status as of .*?: \*\*PASS\b.*?\*\*\./m.test(text)) return "PASS";
  if (/^Status as of .*?: \*\*all blocker inventories still require resolution or approval\*\*\./m.test(text)) {
    return "BLOCKED";
  }
  failures.push(
    "blocker inventory index status must be PASS or all blocker inventories still require resolution or approval"
  );
  return null;
}

function checkGithubIssues(expectedStatus) {
  const results = [];
  for (const number of requiredIssues) {
    const issue = readGithubIssue(number, {
      includeComments: expectedStatus === "pass" && allowOpenApprovedIssues,
    });
    results.push(issue);
    if (!issue.ok) continue;
    if (expectedStatus === "blocked" && issue.state !== "OPEN") {
      failures.push(`#${number} should stay OPEN while customer submission DoD is blocked; got ${issue.state}`);
    }
    if (expectedStatus === "pass" && issue.state !== "CLOSED") {
      if (allowOpenApprovedIssues && issueHasApproval(issue)) {
        issue.approvalAccepted = true;
      } else {
        failures.push(
          `#${number} must be CLOSED before customer submission DoD PASS` +
            (allowOpenApprovedIssues ? " or contain the required approval comment" : "") +
            `; got ${issue.state}`
        );
      }
    }
  }
  return results;
}

function readGithubIssue(number, options = {}) {
  const fields = options.includeComments
    ? "number,state,title,updatedAt,comments"
    : "number,state,title,updatedAt";
  const result = spawnSync(
    "gh",
    ["issue", "view", String(number), "--json", fields],
    { cwd: root, encoding: "utf8", windowsHide: true }
  );
  if (result.status !== 0) {
    failures.push(`#${number} GitHub issue lookup failed: ${(result.stderr || result.stdout).trim()}`);
    return { number, ok: false };
  }
  try {
    return { ok: true, ...JSON.parse(result.stdout) };
  } catch (error) {
    failures.push(`#${number} GitHub issue JSON parse failed: ${error.message}`);
    return { number, ok: false };
  }
}

function issueHasApproval(issue) {
  const needles = issueApprovalNeedles.get(issue.number) ?? [];
  const comments = Array.isArray(issue.comments) ? issue.comments : [];
  return comments.some((comment) => {
    if (approvalAuthors.length > 0 && !approvalAuthors.includes(comment?.author?.login)) {
      return false;
    }
    const body = normalizeApprovalText(approvalCandidateText(comment?.body ?? ""));
    if (!body.startsWith("Approved:")) return false;
    return needles.every((needle) => body.includes(normalizeApprovalText(needle)));
  });
}

function approvalCandidateText(markdown) {
  const lines = String(markdown).split(/\r?\n/);
  const kept = [];
  let inFence = false;
  for (const line of lines) {
    if (/^\s*```/.test(line)) {
      inFence = !inFence;
      continue;
    }
    if (inFence) continue;
    if (/^\s*>/.test(line)) continue;
    kept.push(line);
  }
  return kept.join("\n");
}

function normalizeApprovalText(value) {
  return value.replace(/\s+/g, " ").trim();
}

function checkWorkbook(path, expectedStatus) {
  const result = { path };
  if (!existsSync(path)) {
    failures.push(`missing workbook: ${path}`);
    return { ...result, exists: false };
  }
  result.exists = true;
  const entries = readZipEntries(path);
  const entryNames = new Set(entries.keys());
  const extension = extname(path).toLowerCase();
  if (extension === ".xlsm" && ![...entryNames].some((name) => name.endsWith("vbaProject.bin"))) {
    failures.push(`xlsm workbook missing vbaProject.bin: ${path}`);
  }

  const workbook = workbookModel(entries, path);
  result.sheets = workbook.sheets.map((sheet) => sheet.name);
  result.firstSheet = result.sheets[0] ?? null;
  const dodSheet = workbook.sheets.find((sheet) => sheet.name === "vFinal提出DOD照合");
  if (!dodSheet) {
    failures.push(`workbook missing vFinal提出DOD照合 sheet: ${path}`);
    return result;
  }
  if (workbook.sheets[0]?.name !== "vFinal提出DOD照合") {
    failures.push(`workbook first sheet is not vFinal提出DOD照合: ${path}`);
  }

  const dodCells = worksheetCells(entries, dodSheet.target, workbook.sharedStrings, path);
  const overallStatus = dodCells.get("B2");
  result.overallStatus = overallStatus ?? null;
  if (expectedStatus === "blocked") {
    requireEqual(overallStatus, "BLOCKED", `workbook ${path} overall DoD status`);
    for (const cell of ["B3", "B4", "B5", "B6", "B7"]) {
      requireEqual(dodCells.get(cell), "BLOCKED", `workbook ${path} ${cell}`);
    }
  }
  if (expectedStatus === "pass") {
    requireEqual(overallStatus, "PASS", `workbook ${path} overall DoD status`);
    for (const cell of ["B3", "B4", "B5", "B6", "B7"]) {
      if (dodCells.get(cell) === "BLOCKED") {
        failures.push(`workbook ${path} still has BLOCKED in ${cell}`);
      }
    }
  }

  const allText = workbook.sheets
    .flatMap((sheet) => [...worksheetCells(entries, sheet.target, workbook.sharedStrings, path).values()])
    .join("\n");
  if (allText.includes("プランが完了した前提")) {
    failures.push(`workbook still contains old completion premise wording: ${path}`);
  }
  for (const staleUrlClaim of [
    "参加者ブラウザ -> roleplay.mendan.biz",
    "ブラウザは roleplay.mendan.biz と voice.mendan.biz のみに接続",
  ]) {
    if (allText.includes(staleUrlClaim)) {
      failures.push(`workbook still contains stale submitted URL wording (${staleUrlClaim}): ${path}`);
    }
  }
  if (expectedStatus === "blocked" && !allText.includes("vFinal提出URLは#138未確定")) {
    failures.push(`workbook missing #138 submitted URL uncertainty wording: ${path}`);
  }
  if (expectedStatus === "blocked") {
    for (const required of [
      "#171",
      "Excel人間確認 (#171)",
      "docs/security/adecco-vfinal-workbook-human-confirmation-cell-map.md",
      "pre-vFinal >=20セッションbaselineとの正式比較が必要",
      "baseline不足の免除ではPASS不可",
    ]) {
      if (!allText.includes(required)) {
        failures.push(`workbook missing required blocked-mode wording (${required}): ${path}`);
      }
    }
  }
  for (const staleLatencyClaim of [
    "明示承認されたwaiver/代替baseline",
    "waiver/代替baselineが必要",
  ]) {
    if (allText.includes(staleLatencyClaim)) {
      failures.push(`workbook still contains stale #140 waiver wording (${staleLatencyClaim}): ${path}`);
    }
  }
  for (const forbidden of [
    "Customer submission DoD: PASS",
    "総合DODはPASS",
    "正式提出PASSとして扱う",
  ]) {
    if (allText.includes(forbidden)) {
      failures.push(`workbook contains unsupported final PASS claim (${forbidden}): ${path}`);
    }
  }
  result.checked = true;
  return result;
}

function workbookModel(entries, path) {
  const workbookXml = textEntry(entries, "xl/workbook.xml", path);
  const relsXml = textEntry(entries, "xl/_rels/workbook.xml.rels", path);
  const sharedStrings = entries.has("xl/sharedStrings.xml")
    ? sharedStringValues(textEntry(entries, "xl/sharedStrings.xml", path))
    : [];
  const relTargets = new Map(
    [...relsXml.matchAll(/<Relationship\b([^>]+)>/g)].map((match) => {
      const attrs = xmlAttrs(match[1]);
      return [attrs.Id, normalizeWorkbookTarget(attrs.Target ?? "")];
    })
  );
  const sheets = [...workbookXml.matchAll(/<sheet\b([^>]+)>/g)].map((match) => {
    const attrs = xmlAttrs(match[1]);
    return {
      name: decodeXml(attrs.name ?? ""),
      id: attrs.sheetId ?? "",
      relId: attrs["r:id"] ?? attrs.id ?? "",
      target: relTargets.get(attrs["r:id"] ?? attrs.id ?? "") ?? "",
    };
  });
  if (sheets.length === 0) {
    failures.push(`workbook has no sheets: ${path}`);
  }
  return { sheets, sharedStrings };
}

function worksheetCells(entries, target, sharedStrings, path) {
  const xml = textEntry(entries, target, path);
  const cells = new Map();
  for (const match of xml.matchAll(/<c\b([^>]*)>([\s\S]*?)<\/c>/g)) {
    const attrs = xmlAttrs(match[1]);
    const ref = attrs.r;
    if (!ref) continue;
    const type = attrs.t;
    const body = match[2];
    let value = "";
    if (type === "s") {
      const index = Number(firstXmlValue(body, "v"));
      value = sharedStrings[index] ?? "";
    } else if (type === "inlineStr") {
      value = inlineStringValue(body);
    } else {
      value = firstXmlValue(body, "v");
    }
    cells.set(ref, value);
  }
  return cells;
}

function sharedStringValues(xml) {
  return [...xml.matchAll(/<si\b[^>]*>([\s\S]*?)<\/si>/g)].map((match) =>
    inlineStringValue(match[1])
  );
}

function inlineStringValue(xml) {
  return [...xml.matchAll(/<t\b[^>]*>([\s\S]*?)<\/t>/g)]
    .map((match) => decodeXml(match[1]))
    .join("");
}

function firstXmlValue(xml, tag) {
  const match = new RegExp(`<${tag}\\b[^>]*>([\\s\\S]*?)<\\/${tag}>`).exec(xml);
  return match ? decodeXml(match[1]) : "";
}

function textEntry(entries, name, path) {
  const buffer = entries.get(name);
  if (!buffer) {
    failures.push(`workbook ${path} missing zip entry ${name}`);
    return "";
  }
  return buffer.toString("utf8");
}

function readZipEntries(path) {
  const buffer = readFileSync(path);
  const entries = new Map();
  let offset = findEndOfCentralDirectory(buffer);
  if (offset < 0) {
    failures.push(`workbook is not a readable zip file: ${path}`);
    return entries;
  }
  const centralDirectorySize = buffer.readUInt32LE(offset + 12);
  const centralDirectoryOffset = buffer.readUInt32LE(offset + 16);
  const end = centralDirectoryOffset + centralDirectorySize;
  offset = centralDirectoryOffset;
  while (offset < end && buffer.readUInt32LE(offset) === 0x02014b50) {
    const method = buffer.readUInt16LE(offset + 10);
    const compressedSize = buffer.readUInt32LE(offset + 20);
    const uncompressedSize = buffer.readUInt32LE(offset + 24);
    const fileNameLength = buffer.readUInt16LE(offset + 28);
    const extraLength = buffer.readUInt16LE(offset + 30);
    const commentLength = buffer.readUInt16LE(offset + 32);
    const localHeaderOffset = buffer.readUInt32LE(offset + 42);
    const name = buffer
      .subarray(offset + 46, offset + 46 + fileNameLength)
      .toString("utf8")
      .replace(/\\/g, "/");
    const localNameLength = buffer.readUInt16LE(localHeaderOffset + 26);
    const localExtraLength = buffer.readUInt16LE(localHeaderOffset + 28);
    const dataOffset = localHeaderOffset + 30 + localNameLength + localExtraLength;
    const compressed = buffer.subarray(dataOffset, dataOffset + compressedSize);
    let data;
    if (method === 0) {
      data = compressed;
    } else if (method === 8) {
      data = inflateRawSync(compressed);
    } else {
      failures.push(`unsupported zip compression method ${method} in ${path}:${name}`);
      data = Buffer.alloc(0);
    }
    if (uncompressedSize !== 0 && data.length !== uncompressedSize) {
      failures.push(`zip entry size mismatch in ${path}:${name}`);
    }
    entries.set(name, data);
    offset += 46 + fileNameLength + extraLength + commentLength;
  }
  return entries;
}

function findEndOfCentralDirectory(buffer) {
  const min = Math.max(0, buffer.length - 0xffff - 22);
  for (let offset = buffer.length - 22; offset >= min; offset -= 1) {
    if (buffer.readUInt32LE(offset) === 0x06054b50) return offset;
  }
  return -1;
}

function normalizeWorkbookTarget(target) {
  const normalized = target.replace(/\\/g, "/").replace(/^\//, "");
  return normalized.startsWith("xl/") ? normalized : `xl/${normalized}`;
}

function xmlAttrs(source) {
  const attrs = {};
  for (const match of source.matchAll(/([\w:-]+)="([^"]*)"/g)) {
    attrs[match[1]] = decodeXml(match[2]);
  }
  return attrs;
}

function decodeXml(value) {
  return value
    .replace(/&#x([0-9a-fA-F]+);/g, (_, hex) => String.fromCodePoint(Number.parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, decimal) => String.fromCodePoint(Number.parseInt(decimal, 10)))
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, "\"")
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&");
}

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

function boolArg(name) {
  const flag = `--${name}`;
  const prefix = `${flag}=`;
  const value = process.argv.find((arg) => arg === flag || arg.startsWith(prefix));
  if (!value) return false;
  if (value === flag) return true;
  return !["0", "false", "no"].includes(value.slice(prefix.length).toLowerCase());
}

function listArgs(name) {
  const prefix = `--${name}=`;
  return process.argv
    .filter((value) => value.startsWith(prefix))
    .map((value) => value.slice(prefix.length))
    .filter(Boolean);
}

function envList(name) {
  return (process.env[name] ?? "")
    .split(";")
    .map((value) => value.trim())
    .filter(Boolean);
}

function runSelfTest() {
  const cases = [
    {
      name: "fenced approval template is ignored",
      issue: {
        number: 138,
        comments: [
          {
            author: { login: "approver" },
            body: [
              "For #138 use:",
              "```text",
              "Approved: the dedicated hosted.app URL is acceptable as the vFinal customer",
              "submitted URL.",
              "```",
            ].join("\n"),
          },
        ],
      },
      authors: ["approver"],
      expected: false,
    },
    {
      name: "blockquote approval template is ignored",
      issue: {
        number: 141,
        comments: [
          {
            author: { login: "approver" },
            body: [
              "> Approved: the current verify:acceptance blocker is a legacy ConvAI vendor judge",
              "> blocker outside the vFinal submitted runtime/security scope. It may remain open",
              "> outside the customer submission DoD.",
            ].join("\n"),
          },
        ],
      },
      authors: ["approver"],
      expected: false,
    },
    {
      name: "latency baseline comparison approval text is accepted",
      issue: {
        number: 140,
        comments: [
          {
            author: { login: "approver" },
            body: [
              "Approved: use the following pre-vFinal latency baseline for the vFinal customer submission comparison.",
              "Baseline source: approved pre-vFinal same-environment sample 2026-05-17.",
              "pre-vFinal sessions >=20.",
              "sessionApiMs p95: baseline 260ms, current 301ms.",
              "firstAudioDeltaMs p95: baseline 5450ms, current 5529ms.",
              "firstAudibleAudioMs p95: baseline 5660ms, current 5743ms.",
              "Comparison result: PASS.",
            ].join("\n"),
          },
        ],
      },
      authors: ["approver"],
      expected: true,
    },
    {
      name: "latency baseline waiver without comparison is rejected",
      issue: {
        number: 140,
        comments: [
          {
            author: { login: "approver" },
            body: [
              "Approved: accept the current-vFinal 20-session latency sample as scoped evidence",
              "and waive the missing strict pre-vFinal baseline for this submission.",
            ].join("\n"),
          },
        ],
      },
      authors: ["approver"],
      expected: false,
    },
    {
      name: "all approval-packet plain templates are accepted",
      issue: {
        number: 139,
        comments: [
          {
            author: { login: "approver" },
            body: [
              "Approved: the vFinal customer-submitted runtime scope is limited to the",
              "dedicated no-key App Hosting backend adecco-roleplay-vfinal and its submitted",
              "URL. Legacy shared App Hosting routes and their XAI_API_KEY access are internal",
              "comparison/continuity infrastructure and are out of scope for the vFinal",
              "customer submission.",
            ].join("\n"),
          },
        ],
      },
      authors: ["approver"],
      expected: true,
    },
    {
      name: "legacy XAI approval without explicit out-of-scope text is rejected",
      issue: {
        number: 139,
        comments: [
          {
            author: { login: "approver" },
            body: [
              "Approved: the vFinal customer-submitted runtime scope is limited to the",
              "dedicated no-key App Hosting backend adecco-roleplay-vfinal and its submitted URL.",
            ].join("\n"),
          },
        ],
      },
      authors: ["approver"],
      expected: false,
    },
    {
      name: "acceptance approval requires vFinal runtime/security scope text",
      issue: {
        number: 141,
        comments: [
          {
            author: { login: "approver" },
            body: [
              "Approved: the current verify:acceptance blocker is a legacy ConvAI vendor judge",
              "outside the customer submission DoD.",
            ].join("\n"),
          },
        ],
      },
      authors: ["approver"],
      expected: false,
    },
    {
      name: "approval-packet acceptance template is accepted",
      issue: {
        number: 141,
        comments: [
          {
            author: { login: "approver" },
            body: [
              "Approved: the current verify:acceptance blocker is a legacy ConvAI vendor judge",
              "blocker outside the vFinal submitted runtime/security scope. It may remain open",
              "outside the customer submission DoD.",
            ].join("\n"),
          },
        ],
      },
      authors: ["approver"],
      expected: true,
    },
    {
      name: "fenced workbook confirmation approval template is ignored",
      issue: {
        number: 171,
        comments: [
          {
            author: { login: "approver" },
            body: [
              "For #171 use:",
              "```text",
              "Approved: all cells listed in",
              "docs/security/adecco-vfinal-workbook-human-confirmation-cell-map.md",
              "have been human-confirmed or rewritten to explicit unresolved/not-applicable answers,",
              "and the questionnaire drafts may be treated as final submission artifacts.",
              "```",
            ].join("\n"),
          },
        ],
      },
      authors: ["approver"],
      expected: false,
    },
    {
      name: "workbook confirmation approval template is accepted",
      issue: {
        number: 171,
        comments: [
          {
            author: { login: "approver" },
            body: [
              "Approved: all cells listed in",
              "docs/security/adecco-vfinal-workbook-human-confirmation-cell-map.md",
              "have been human-confirmed or rewritten to explicit unresolved/not-applicable answers,",
              "and the questionnaire drafts may be treated as final submission artifacts.",
            ].join("\n"),
          },
        ],
      },
      authors: ["approver"],
      expected: true,
    },
    {
      name: "workbook confirmation approval without final artifact text is rejected",
      issue: {
        number: 171,
        comments: [
          {
            author: { login: "approver" },
            body: [
              "Approved: all cells listed in",
              "docs/security/adecco-vfinal-workbook-human-confirmation-cell-map.md",
              "have been human-confirmed or rewritten to explicit unresolved/not-applicable answers.",
            ].join("\n"),
          },
        ],
      },
      authors: ["approver"],
      expected: false,
    },
    {
      name: "wrong approval author is rejected",
      issue: {
        number: 138,
        comments: [
          {
            author: { login: "someone-else" },
            body: [
              "Approved: the dedicated hosted.app URL is acceptable as the vFinal customer",
              "submitted URL.",
            ].join("\n"),
          },
        ],
      },
      authors: ["approver"],
      expected: false,
    },
  ];

  const originalAuthors = [...approvalAuthors];
  const failed = [];
  for (const testCase of cases) {
    approvalAuthors.splice(0, approvalAuthors.length, ...testCase.authors);
    const actual = issueHasApproval(testCase.issue);
    if (actual !== testCase.expected) {
      failed.push(`${testCase.name}: expected ${testCase.expected}, got ${actual}`);
    }
  }
  approvalAuthors.splice(0, approvalAuthors.length, ...originalAuthors);

  if (failed.length > 0) {
    console.error("vFinal customer submission DoD status self-test FAILED");
    for (const failure of failed) {
      console.error(`- ${failure}`);
    }
    process.exit(1);
  }
  console.log("vFinal customer submission DoD status self-test PASS");
}
