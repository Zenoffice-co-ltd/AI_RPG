import {
  AdeccoEvaluationResultPageShell,
  type AdeccoEvaluationResultPageProps,
} from "@/components/roleplay/evaluation/AdeccoEvaluationResultPageShell";

export const dynamic = "force-dynamic";

export default function AdeccoRoleplayV5074DResultPage(
  props: AdeccoEvaluationResultPageProps,
) {
  return (
    <AdeccoEvaluationResultPageShell
      {...props}
      accessAction="/demo/adecco-roleplay-v50-7-4-d/access"
      roleplayPath="/demo/adecco-roleplay-v50-7-4-d"
    />
  );
}
