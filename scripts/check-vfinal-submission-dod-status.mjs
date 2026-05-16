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
const requiredIssues = [138, 139, 140, 141];
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
      "dedicated no-key App Hosting backend adecco-roleplay-vfinal and its submitted",
      "customer submission.",
    ],
  ],
  [
    140,
    [
      "Approved: accept the current-vFinal 20-session latency sample as scoped evidence",
      "waive the missing strict pre-vFinal baseline for this submission.",
    ],
  ],
  [
    141,
    [
      "Approved: the current verify:acceptance blocker is a legacy ConvAI vendor judge",
      "outside the customer submission DoD.",
    ],
  ],
]);
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
      auditStatus,
      questionnaireMapStatus,
      blockers: normalizedExpected === "blocked" ? ["#138", "#139", "#140", "#141"] : [],
      workbooks: workbookResults,
      githubIssues,
    },
    null,
    2
  )
);

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
    for (const cell of ["B3", "B4", "B5", "B6"]) {
      requireEqual(dodCells.get(cell), "BLOCKED", `workbook ${path} ${cell}`);
    }
  }
  if (expectedStatus === "pass") {
    requireEqual(overallStatus, "PASS", `workbook ${path} overall DoD status`);
    for (const cell of ["B3", "B4", "B5", "B6"]) {
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
