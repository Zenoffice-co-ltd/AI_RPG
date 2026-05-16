import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

const root = process.cwd();
const webRoot = join(root, "apps", "web");
const configPackage = "@top-performer/grok-first-roleplay-config";
const promptNeedles = [
  "あなたは常に、住宅設備メーカーのじんじ課主任、佐藤",
  "Priority 0: 最上位出力契約",
  "固定ガード応答",
  "hiddenAssistantHistory",
];

const failures = [];

for (const file of listFiles(webRoot).filter((path) => /\.(ts|tsx)$/.test(path))) {
  const source = readFileSync(file, "utf8");
  if (!source.includes(configPackage)) continue;
  const firstMeaningfulLine = source
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find((line) => line.length > 0 && !line.startsWith("//"));
  if (firstMeaningfulLine === "\"use client\";" || firstMeaningfulLine === "'use client';") {
    failures.push(`client import of ${configPackage}: ${file}`);
  }
}

const staticRoot = join(webRoot, ".next", "static");
if (existsSync(staticRoot)) {
  for (const file of listFiles(staticRoot)) {
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
