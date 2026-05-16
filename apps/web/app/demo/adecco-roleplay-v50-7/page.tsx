import {
  GrokFirstV50RoleplayPage,
  type GrokFirstV50RouteProps,
} from "@/components/roleplay/GrokFirstV50RoleplayPage";

export const dynamic = "force-dynamic";

export default function AdeccoRoleplayV507Route(props: GrokFirstV50RouteProps) {
  return (
    <GrokFirstV50RoleplayPage
      {...props}
      accessAction="/demo/adecco-roleplay-v50-7/access"
      apiBase="/api/grok-first-v50-7"
    />
  );
}
