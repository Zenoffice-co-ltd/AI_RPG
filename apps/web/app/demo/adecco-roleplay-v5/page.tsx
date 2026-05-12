import {
  GrokVoiceRoleplayPage,
  type DemoPageProps,
} from "@/components/roleplay/GrokVoiceRoleplayPage";

export const dynamic = "force-dynamic";

export default function GrokVoiceRoleplayV5Route(props: DemoPageProps) {
  return (
    <GrokVoiceRoleplayPage
      {...props}
      accessAction="/demo/adecco-roleplay-v5/access"
      demoSlug="adecco-roleplay-v5"
    />
  );
}
