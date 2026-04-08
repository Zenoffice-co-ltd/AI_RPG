import { buildPlaybooksJob } from "../apps/web/server/use-cases/admin";

function getArg(name: string) {
  const index = process.argv.indexOf(name);
  if (index === -1) {
    const prefixed = process.argv.find((arg) => arg.startsWith(`${name}=`));
    return prefixed ? prefixed.slice(`${name}=`.length) : undefined;
  }
  return process.argv[index + 1];
}

async function main() {
  const family = getArg("--family") ?? "staffing_order_hearing";
  const mode = getArg("--mode");
  const result = await buildPlaybooksJob({
    family,
    ...(mode ? { mode } : {}),
  });
  console.info(JSON.stringify(result, null, 2));
}

void main();
