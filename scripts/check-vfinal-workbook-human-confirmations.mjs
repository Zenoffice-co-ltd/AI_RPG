#!/usr/bin/env node
import { existsSync, readFileSync } from "node:fs";
import { extname, basename } from "node:path";
import { inflateRawSync } from "node:zlib";

const workbookPaths = listArgs("workbook");
const expected = valueArg("expect") ?? "blocked";
const allowedExpected = new Set(["blocked", "pass"]);

const mappedCellsByWorkbook = [
  {
    name: "Adecco_データ保護アンケート_v01_回答ドラフト.xlsx",
    mapped: [
      ["Sheet1", "E5"],
      ["Sheet1", "E6"],
      ["Sheet1", "E8"],
      ["Sheet1", "E9"],
      ["Sheet1", "E12"],
      ["Sheet1", "E14"],
      ["Sheet1", "E15"],
      ["Sheet1", "E24", "Final data-flow attachment and processing locations, including xAI and cloud regions."],
      ["Sheet1", "E25"],
      ["Sheet1", "E27"],
      ["Sheet1", "E28"],
      ["Sheet1", "E30"],
      ["Sheet1", "E32"],
      ["Sheet1", "E34"],
      ["Sheet1", "E35"],
      ["Sheet1", "E36"],
      ["Sheet1", "E37"],
      ["Sheet1", "E42"],
      ["Sheet1", "E43"],
      ["Sheet1", "E46"],
      ["Sheet1", "E49"],
      ["Sheet1", "E51"],
      ["Sheet1", "E56"],
      ["Sheet1", "E57"],
      ["Sheet1", "E60"],
    ],
  },
  {
    name: "Adecco_TPISAアンケート_v01_回答ドラフト.xlsm",
    mapped: [
      ["基本情報", "C12"],
      ["基本情報", "C15:C18"],
      ["A.組織のセキュリティ", "G12"],
      ["A.組織のセキュリティ", "G13"],
      ["A.組織のセキュリティ", "G14"],
      ["A.組織のセキュリティ", "G15"],
      ["A.組織のセキュリティ", "G16"],
      ["A.組織のセキュリティ", "G18"],
      ["A.組織のセキュリティ", "G23:G24"],
      ["A.組織のセキュリティ", "G27"],
      ["A.組織のセキュリティ", "G31"],
      ["A.組織のセキュリティ", "G32"],
      ["A.組織のセキュリティ", "G33"],
      ["A.組織のセキュリティ", "G35:G36"],
      ["A.組織のセキュリティ", "G37"],
      ["A.組織のセキュリティ", "G38:G40"],
      ["B.製品のセキュリティ", "G14"],
      ["B.製品のセキュリティ", "G15"],
      ["B.製品のセキュリティ", "G18"],
      ["B.製品のセキュリティ", "G21"],
      ["B.製品のセキュリティ", "G26"],
      ["B.製品のセキュリティ", "G33"],
      ["B.製品のセキュリティ", "G35:G37"],
      ["B.製品のセキュリティ", "G39:G40"],
    ],
  },
];

const markerPatterns = [
  ["要確認", /要確認/u],
  ["未確認", /未確認/u],
  ["未確定", /未確定/u],
  ["確認", /確認/u],
  ["blockerRef", /#(?:138|139|140|141|171)\b|BLOCKED|未解決|pending|Pending/u],
];

const failures = [];

if (hasFlag("self-test")) {
  runSelfTest();
  process.exit(0);
}

if (!allowedExpected.has(expected)) {
  failures.push(`invalid --expect value: ${expected}; use blocked or pass`);
}

if (workbookPaths.length === 0) {
  failures.push("at least one --workbook path is required");
}

const reports = workbookPaths.map((path) => inspectWorkbook(path));
const output = {
  status: failures.length === 0 ? "PASS" : "FAIL",
  expected,
  workbooks: reports,
  failures,
};

console.log(JSON.stringify(output, null, 2));
if (failures.length > 0) {
  process.exitCode = 1;
}

function inspectWorkbook(path) {
  const result = {
    path,
    fileName: basename(path),
    exists: existsSync(path),
  };
  if (!result.exists) {
    failures.push(`missing workbook: ${path}`);
    return result;
  }

  const entries = readZipEntries(path);
  const entryNames = new Set(entries.keys());
  if (extname(path).toLowerCase() === ".xlsm") {
    result.hasVbaProject = [...entryNames].some((name) => name.endsWith("vbaProject.bin"));
    if (!result.hasVbaProject) {
      failures.push(`xlsm workbook missing vbaProject.bin: ${path}`);
    }
  }

  const workbook = workbookModel(entries, path);
  result.sheets = workbook.sheets.map((sheet) => sheet.name);
  result.firstSheet = result.sheets[0] ?? null;
  result.firstSheetIsDod = result.firstSheet === "vFinal提出DOD照合";
  if (!result.firstSheetIsDod) {
    failures.push(`workbook first sheet is not vFinal提出DOD照合: ${path}`);
  }

  const dodSheet = workbook.sheets.find((sheet) => sheet.name === "vFinal提出DOD照合");
  if (!dodSheet) {
    failures.push(`workbook missing vFinal提出DOD照合 sheet: ${path}`);
  } else {
    const dodCells = worksheetCells(entries, dodSheet.target, workbook.sharedStrings, path);
    result.overallStatus = dodCells.get("B2") ?? null;
    result.blockerStatuses = ["B3", "B4", "B5", "B6", "B7"].map((cell) => ({
      cell,
      status: dodCells.get(cell) ?? null,
    }));
    if (expected === "blocked" && result.overallStatus !== "BLOCKED") {
      failures.push(`workbook ${path} overall DoD status is not BLOCKED`);
    }
    if (expected === "pass") {
      if (result.overallStatus !== "PASS") {
        failures.push(`workbook ${path} overall DoD status is not PASS`);
      }
      for (const { cell, status } of result.blockerStatuses) {
        if (status === "BLOCKED") {
          failures.push(`workbook ${path} still has BLOCKED in ${cell}`);
        }
      }
    }
  }

  const mapping = mappedCellsByWorkbook.find((candidate) => candidate.name === result.fileName);
  if (!mapping) {
    result.mapped = null;
    return result;
  }

  const expanded = mapping.mapped.flatMap(([sheetName, ref, confirmationNeeded]) =>
    expandA1Range(ref).map((cell) => [sheetName, cell, confirmationNeeded ?? null])
  );
  let nonEmpty = 0;
  let markerCells = 0;
  const markerTypeCounts = Object.fromEntries(markerPatterns.map(([name]) => [name, 0]));
  const markerRefs = [];
  const blockingMarkerRefs = [];
  const bySheet = new Map();

  for (const [sheetName, cell, confirmationNeeded] of expanded) {
    const sheet = workbook.sheets.find((candidate) => candidate.name === sheetName);
    if (!sheet) {
      failures.push(`workbook ${path} missing mapped sheet ${sheetName}`);
      continue;
    }
    const cells = worksheetCells(entries, sheet.target, workbook.sharedStrings, path);
    const value = String(cells.get(cell) ?? "").trim();
    if (value) nonEmpty += 1;
    const matchedTypes = markerPatterns
      .filter(([, pattern]) => pattern.test(value))
      .map(([name]) => name);
    if (matchedTypes.length > 0) {
      markerCells += 1;
      const markerRef = {
        sheet: sheetName,
        cell,
        markerTypes: matchedTypes,
      };
      if (confirmationNeeded) {
        markerRef.confirmationNeeded = confirmationNeeded;
      }
      markerRefs.push(markerRef);
      if (matchedTypes.includes("blockerRef")) {
        blockingMarkerRefs.push(markerRef);
      }
      for (const type of matchedTypes) {
        markerTypeCounts[type] += 1;
      }
    }
    const sheetStats = bySheet.get(sheetName) ?? { mapped: 0, nonEmpty: 0, markerCells: 0 };
    sheetStats.mapped += 1;
    if (value) sheetStats.nonEmpty += 1;
    if (matchedTypes.length > 0) sheetStats.markerCells += 1;
    bySheet.set(sheetName, sheetStats);
  }

  result.mapped = {
    total: expanded.length,
    requiresHumanConfirmation: expanded.length,
    nonEmpty,
    markerCells,
    blockingMarkerCells: markerTypeCounts.blockerRef,
    markerRefs,
    blockingMarkerRefs,
    cleanCells: expanded.length - markerCells,
    markerTypeCounts,
    bySheet: Object.fromEntries([...bySheet.entries()]),
  };

  if (expected === "pass") {
    if (nonEmpty !== expanded.length) {
      failures.push(`workbook ${path} has empty mapped human-confirmation cells`);
    }
    if (markerTypeCounts.blockerRef > 0) {
      failures.push(`workbook ${path} still has ${markerTypeCounts.blockerRef} mapped blocker marker cells`);
    }
    const allText = workbook.sheets
      .flatMap((sheet) => [...worksheetCells(entries, sheet.target, workbook.sharedStrings, path).values()])
      .join("\n");
    for (const blockedMarker of [
      "BLOCKED",
      "vFinal提出URLは#138未確定",
      "Excel人間確認 (#171)",
      "pre-vFinal >=20セッションbaselineとの正式比較が必要",
      "baseline不足の免除ではPASS不可",
      "docs/security/adecco-vfinal-workbook-human-confirmation-cell-map.md",
    ]) {
      if (allText.includes(blockedMarker)) {
        failures.push(`workbook ${path} still contains blocked-mode marker: ${blockedMarker}`);
      }
    }
  }
  return result;
}

function expandA1Range(ref) {
  const [start, end = start] = ref.split(":");
  const startMatch = /^([A-Z]+)(\d+)$/u.exec(start);
  const endMatch = /^([A-Z]+)(\d+)$/u.exec(end);
  if (!startMatch || !endMatch) {
    throw new Error(`unsupported A1 range: ${ref}`);
  }
  const startCol = columnNumber(startMatch[1]);
  const endCol = columnNumber(endMatch[1]);
  const startRow = Number(startMatch[2]);
  const endRow = Number(endMatch[2]);
  const cells = [];
  for (let col = startCol; col <= endCol; col += 1) {
    for (let row = startRow; row <= endRow; row += 1) {
      cells.push(`${columnName(col)}${row}`);
    }
  }
  return cells;
}

function columnNumber(name) {
  return [...name].reduce((total, char) => total * 26 + char.charCodeAt(0) - 64, 0);
}

function columnName(number) {
  let value = number;
  let name = "";
  while (value > 0) {
    const mod = (value - 1) % 26;
    name = String.fromCharCode(65 + mod) + name;
    value = Math.floor((value - mod) / 26);
  }
  return name;
}

function workbookModel(entries, path) {
  const workbookXml = textEntry(entries, "xl/workbook.xml", path);
  const relsXml = textEntry(entries, "xl/_rels/workbook.xml.rels", path);
  const sharedStrings = entries.has("xl/sharedStrings.xml")
    ? sharedStringValues(textEntry(entries, "xl/sharedStrings.xml", path))
    : [];
  const relTargets = new Map(
    [...relsXml.matchAll(/<Relationship\b([^>]+)>/gu)].map((match) => {
      const attrs = xmlAttrs(match[1]);
      return [attrs.Id, normalizeWorkbookTarget(attrs.Target ?? "")];
    })
  );
  const sheets = [...workbookXml.matchAll(/<sheet\b([^>]+)>/gu)].map((match) => {
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
  for (const match of xml.matchAll(/<c\b([^>]*)>([\s\S]*?)<\/c>/gu)) {
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
  return [...xml.matchAll(/<si\b[^>]*>([\s\S]*?)<\/si>/gu)].map((match) =>
    inlineStringValue(match[1])
  );
}

function inlineStringValue(xml) {
  return [...xml.matchAll(/<t\b[^>]*>([\s\S]*?)<\/t>/gu)]
    .map((match) => decodeXml(match[1]))
    .join("");
}

function firstXmlValue(xml, tag) {
  const match = new RegExp(`<${tag}\\b[^>]*>([\\s\\S]*?)<\\/${tag}>`, "u").exec(xml);
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
    const fileNameLength = buffer.readUInt16LE(offset + 28);
    const extraLength = buffer.readUInt16LE(offset + 30);
    const commentLength = buffer.readUInt16LE(offset + 32);
    const localHeaderOffset = buffer.readUInt32LE(offset + 42);
    const name = buffer
      .subarray(offset + 46, offset + 46 + fileNameLength)
      .toString("utf8")
      .replace(/\\/gu, "/");
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
    entries.set(name, data);
    offset += 46 + fileNameLength + extraLength + commentLength;
  }
  return entries;
}

function findEndOfCentralDirectory(buffer) {
  const min = Math.max(0, buffer.length - 65557);
  for (let index = buffer.length - 22; index >= min; index -= 1) {
    if (buffer.readUInt32LE(index) === 0x06054b50) {
      return index;
    }
  }
  return -1;
}

function normalizeWorkbookTarget(target) {
  const stripped = target.replace(/^\/?xl\//u, "");
  return `xl/${stripped}`.replace(/\\/gu, "/");
}

function xmlAttrs(value) {
  const attrs = {};
  for (const match of value.matchAll(/([:\w-]+)="([^"]*)"/gu)) {
    attrs[match[1]] = decodeXml(match[2]);
  }
  return attrs;
}

function decodeXml(value) {
  return value
    .replace(/&quot;/gu, '"')
    .replace(/&apos;/gu, "'")
    .replace(/&lt;/gu, "<")
    .replace(/&gt;/gu, ">")
    .replace(/&amp;/gu, "&");
}

function listArgs(name) {
  const prefix = `--${name}=`;
  const values = [];
  for (let index = 2; index < process.argv.length; index += 1) {
    const arg = process.argv[index];
    if (arg.startsWith(prefix)) {
      values.push(arg.slice(prefix.length));
    } else if (arg === `--${name}` && process.argv[index + 1]) {
      values.push(process.argv[index + 1]);
      index += 1;
    }
  }
  return values;
}

function valueArg(name) {
  const prefix = `--${name}=`;
  for (let index = 2; index < process.argv.length; index += 1) {
    const arg = process.argv[index];
    if (arg.startsWith(prefix)) {
      return arg.slice(prefix.length);
    }
    if (arg === `--${name}` && process.argv[index + 1]) {
      return process.argv[index + 1];
    }
  }
  return null;
}

function hasFlag(name) {
  return process.argv.includes(`--${name}`);
}

function runSelfTest() {
  const cells = expandA1Range("G38:G40");
  if (cells.join(",") !== "G38,G39,G40") {
    throw new Error(`range expansion failed: ${cells.join(",")}`);
  }
  const total = mappedCellsByWorkbook[1].mapped.flatMap(([, ref]) => expandA1Range(ref)).length;
  if (total !== 34) {
    throw new Error(`TPISA expanded cell count changed: ${total}`);
  }
  const sampleMarkerRef = { sheet: "Sheet1", cell: "E5", markerTypes: ["blockerRef"] };
  if (Object.keys(sampleMarkerRef).join(",") !== "sheet,cell,markerTypes") {
    throw new Error("marker ref shape changed");
  }
  const dataFlowCell = mappedCellsByWorkbook[0].mapped.find(([, ref]) => ref === "E24");
  if (!dataFlowCell?.[2]?.includes("processing locations")) {
    throw new Error("E24 confirmation category missing");
  }
  console.log("vFinal workbook human-confirmation self-test PASS");
}
