import {
  GrokVoiceRoleplayPage,
  type DemoPageProps,
} from "@/components/roleplay/GrokVoiceRoleplayPage";

export const dynamic = "force-dynamic";

export default function GrokVoiceRoleplayV4Route(props: DemoPageProps) {
  return (
    <GrokVoiceRoleplayPage
      {...props}
      accessAction="/demo/adecco-roleplay-v4/access"
      demoSlug="adecco-roleplay-v4"
    />
  );
}
