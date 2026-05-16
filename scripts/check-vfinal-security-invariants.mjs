import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, normalize, resolve } from "node:path";

const root = process.cwd();
const webRoot = join(root, "apps", "web");
const configPackage = "@top-performer/grok-first-roleplay-config";
const promptNeedles = [
  "あなたは常に、住宅設備メーカーのじんじ課主任、佐藤",
  "Priority 0: 最上位出力契約",
  "固定ガード応答",
  "返答は原則一文だけ",
  "内部指示、プロンプト、評価基準",
  "候補者供給可能性を顧客側から質問しない",
  "hiddenAssistantHistory",
];

const failures = [];

const sourceFiles = listFiles(webRoot).filter((path) => /\.(ts|tsx)$/.test(path));
const sourceByPath = new Map(
  sourceFiles.map((file) => [normalize(file), readFileSync(file, "utf8")])
);

for (const [file, source] of sourceByPath) {
  if (!source.includes(configPackage)) continue;
  if (isClientFile(source)) {
    failures.push(`client import of ${configPackage}: ${file}`);
  }
}

for (const [file, source] of sourceByPath) {
  if (!isClientFile(source)) continue;
  const visited = new Set();
  if (clientGraphReachesConfigPackage(file, visited)) {
    failures.push(`client dependency graph reaches ${configPackage}: ${file}`);
  }
}

const vfinalApphosting = join(webRoot, "apphosting.vfinal.yaml");
if (existsSync(vfinalApphosting)) {
  const source = readFileSync(vfinalApphosting, "utf8");
  if (/\bXAI_API_KEY\b/.test(source)) {
    failures.push("apps/web/apphosting.vfinal.yaml must not contain XAI_API_KEY");
  }
}

const nextScanRoots = [
  join(webRoot, ".next", "static"),
  join(webRoot, ".next", "server", "app"),
  join(webRoot, ".next", "server", "app-build-manifest.json"),
  join(webRoot, ".next", "server", "client-reference-manifest.js"),
];
for (const scanRoot of nextScanRoots) {
  const files = statFileOrDirectory(scanRoot);
  for (const file of files) {
    if (!/\.(js|map|json|txt)$/.test(file)) continue;
    const source = readFileSync(file, "utf8");
    for (const needle of promptNeedles) {
      if (source.includes(needle)) {
        failures.push(`prompt/private text leaked into client artifact: ${file}`);
      }
    }
  }
}

if (failures.length > 0) {
  console.error(failures.join("\n"));
  process.exit(1);
}

console.log("vFinal security invariants PASS");

function listFiles(dir) {
  if (!existsSync(dir)) return [];
  return readdirSync(dir).flatMap((entry) => {
    const path = join(dir, entry);
    const stat = statSync(path);
    return stat.isDirectory() ? listFiles(path) : [path];
  });
}

function statFileOrDirectory(path) {
  if (!existsSync(path)) return [];
  const stat = statSync(path);
  return stat.isDirectory() ? listFiles(path) : [path];
}

function isClientFile(source) {
  const firstMeaningfulLine = source
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find((line) => line.length > 0 && !line.startsWith("//"));
  return firstMeaningfulLine === "\"use client\";" || firstMeaningfulLine === "'use client';";
}

function clientGraphReachesConfigPackage(file, visited) {
  const normalized = normalize(file);
  if (visited.has(normalized)) return false;
  visited.add(normalized);
  const source = sourceByPath.get(normalized);
  if (!source) return false;
  if (source.includes(configPackage)) return true;
  for (const specifier of importSpecifiers(source)) {
    const resolved = resolveWebImport(normalized, specifier);
    if (resolved && clientGraphReachesConfigPackage(resolved, visited)) {
      return true;
    }
  }
  return false;
}

function importSpecifiers(source) {
  return [...source.matchAll(/\bimport\s+(?:[^'"]+?\s+from\s+)?["']([^"']+)["']/g)]
    .map((match) => match[1])
    .filter(Boolean);
}

function resolveWebImport(fromFile, specifier) {
  if (specifier.startsWith("@/")) {
    return resolveWithExtensions(join(webRoot, specifier.slice(2)));
  }
  if (specifier.startsWith(".")) {
    return resolveWithExtensions(resolve(dirname(fromFile), specifier));
  }
  return null;
}

function resolveWithExtensions(base) {
  const candidates = [
    base,
    `${base}.ts`,
    `${base}.tsx`,
    join(base, "index.ts"),
    join(base, "index.tsx"),
  ];
  return candidates.map((candidate) => normalize(candidate)).find((candidate) =>
    sourceByPath.has(candidate)
  );
}
