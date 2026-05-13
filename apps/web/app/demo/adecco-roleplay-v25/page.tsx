import {
  GrokVoiceRoleplayPage,
  type DemoPageProps,
} from "@/components/roleplay/GrokVoiceRoleplayPage";

export const dynamic = "force-dynamic";

export default function AdeccoRoleplayV25Page(props: DemoPageProps) {
  return (
    <GrokVoiceRoleplayPage
      {...props}
      accessAction="/demo/adecco-roleplay-v25/access"
      demoSlug="adecco-roleplay-v25"
    />
  );
}
