import { getAppContext } from "../apps/web/server/appContext";
import { compileScenariosJob } from "../apps/web/server/use-cases/admin";

async function main() {
  const playbooks = await getAppContext().repositories.playbooks.list();
  const latest = playbooks[0];
  if (!latest) {
    throw new Error("No playbook found. Run pnpm build:playbooks first.");
  }

  const result = await compileScenariosJob({
    playbookVersion: latest.version,
  });
  console.info(JSON.stringify(result, null, 2));
}

void main();
