import {
  AdeccoRoleplayPage,
  type DemoPageProps,
} from "@/components/roleplay/AdeccoRoleplayPage";

export const dynamic = "force-dynamic";

export default function AdeccoRoleplayRoute(props: DemoPageProps) {
  return (
    <AdeccoRoleplayPage
      {...props}
      accessAction="/demo/adecco-roleplay/access"
    />
  );
}
