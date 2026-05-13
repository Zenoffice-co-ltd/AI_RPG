import {
  GrokVoiceRoleplayPage,
  type DemoPageProps,
} from "@/components/roleplay/GrokVoiceRoleplayPage";

export const dynamic = "force-dynamic";

export default function AdeccoRoleplayV24Page(props: DemoPageProps) {
  return (
    <GrokVoiceRoleplayPage
      {...props}
      accessAction="/demo/adecco-roleplay-v24/access"
      demoSlug="adecco-roleplay-v24"
    />
  );
}
