import { getAppContext } from "../apps/web/server/appContext";
import { compileScenariosJob } from "../apps/web/server/use-cases/admin";

function getArg(name: string) {
  const index = process.argv.indexOf(name);
  if (index === -1) {
    const prefixed = process.argv.find((arg) => arg.startsWith(`${name}=`));
    return prefixed ? prefixed.slice(`${name}=`.length) : undefined;
  }
  return process.argv[index + 1];
}

async function main() {
  const family = getArg("--family");
  const mode = getArg("--mode");
  const referenceArtifactPath = getArg("--reference");
  const acceptanceReferencePath = getArg("--acceptance-reference");
  const designMemoPath = getArg("--design-memo");
  const referenceOnlyStaffingCompile =
    family === "staffing_order_hearing" && Boolean(referenceArtifactPath);

  const latest = referenceOnlyStaffingCompile
    ? null
    : await getAppContext()
        .repositories.playbooks.list()
        .then((playbooks) =>
          family ? playbooks.find((item) => item.family === family) : playbooks[0]
        );
  if (!latest && !referenceOnlyStaffingCompile) {
    throw new Error("No playbook found. Run pnpm build:playbooks first.");
  }

  const result = await compileScenariosJob({
    ...(latest ? { playbookVersion: latest.version } : {}),
    ...(family ? { family } : {}),
    ...(mode ? { mode } : {}),
    ...((referenceArtifactPath ?? acceptanceReferencePath)
      ? { referenceArtifactPath: referenceArtifactPath ?? acceptanceReferencePath }
      : {}),
    ...(designMemoPath ? { designMemoPath } : {}),
  });
  console.info(JSON.stringify(result, null, 2));
}

void main();
