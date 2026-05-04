import {
  GrokVoiceRoleplayPage,
  type DemoPageProps,
} from "@/components/roleplay/GrokVoiceRoleplayPage";

export const dynamic = "force-dynamic";

export default function GrokVoiceRoleplayRoute(props: DemoPageProps) {
  return (
    <GrokVoiceRoleplayPage
      {...props}
      accessAction="/demo/adecco-roleplay-grok-voice/access"
    />
  );
}
