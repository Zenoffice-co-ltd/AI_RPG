import {
  GrokFirstV50RoleplayPage,
  type GrokFirstV50RouteProps,
} from "@/components/roleplay/GrokFirstV50RoleplayPage";

export const dynamic = "force-dynamic";

export default function AdeccoRoleplayV506Route(props: GrokFirstV50RouteProps) {
  return (
    <GrokFirstV50RoleplayPage
      {...props}
      accessAction="/demo/adecco-roleplay-v50-6/access"
      apiBase="/api/grok-first-v50-6"
    />
  );
}
