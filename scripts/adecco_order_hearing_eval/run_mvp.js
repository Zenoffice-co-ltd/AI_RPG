const { spawnSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");

const defaultZapierPython = "C:/dev/Zapier_GCP_Migration/.venv/Scripts/python.exe";
const pythonExe = process.env.ZAPIER_PYTHON || (fs.existsSync(defaultZapierPython) ? defaultZapierPython : "python");
const scriptPath = path.join(__dirname, "run_adecco_order_hearing_eval.py");
const args = [scriptPath, ...process.argv.slice(2)];

const result = spawnSync(pythonExe, args, { stdio: "inherit" });

if (result.error) {
  console.error(result.error);
  process.exit(1);
}

process.exit(result.status === null ? 1 : result.status);
