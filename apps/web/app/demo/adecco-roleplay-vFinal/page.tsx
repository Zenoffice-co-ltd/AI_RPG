import {
  GrokFirstV50RoleplayPage,
  type GrokFirstV50RouteProps,
} from "@/components/roleplay/GrokFirstV50RoleplayPage";

export const dynamic = "force-dynamic";

export default function AdeccoRoleplayVFinalRoute(props: GrokFirstV50RouteProps) {
  return (
    <GrokFirstV50RoleplayPage
      {...props}
      accessAction="/demo/adecco-roleplay-vFinal/access"
      apiBase="/api/grok-first-vFinal"
      accessMode="vfinal-invite"
    />
  );
}
