import {
  AdeccoEvaluationResultPageShell,
  type AdeccoEvaluationResultPageProps,
} from "@/components/roleplay/evaluation/AdeccoEvaluationResultPageShell";

export const dynamic = "force-dynamic";

export default function AdeccoRoleplayV5074CResultPage(
  props: AdeccoEvaluationResultPageProps,
) {
  return (
    <AdeccoEvaluationResultPageShell
      {...props}
      accessAction="/demo/adecco-roleplay-v50-7-4-c/access"
      roleplayPath="/demo/adecco-roleplay-v50-7-4-c"
    />
  );
}
