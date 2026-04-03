import { buildPlaybooksJob } from "../apps/web/server/use-cases/admin";

async function main() {
  const result = await buildPlaybooksJob({
    family: "staffing_order_hearing",
  });
  console.info(JSON.stringify(result, null, 2));
}

void main();
