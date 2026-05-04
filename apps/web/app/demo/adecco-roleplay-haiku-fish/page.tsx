import {
  HaikuFishRoleplayPage,
  type DemoPageProps,
} from "@/components/roleplay/HaikuFishRoleplayPage";

export const dynamic = "force-dynamic";

export default function HaikuFishRoleplayRoute(props: DemoPageProps) {
  return (
    <HaikuFishRoleplayPage
      {...props}
      accessAction="/demo/adecco-roleplay-haiku-fish/access"
    />
  );
}
