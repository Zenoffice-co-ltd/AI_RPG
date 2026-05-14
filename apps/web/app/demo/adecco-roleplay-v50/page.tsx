import {
  GrokFirstV50RoleplayPage,
  type GrokFirstV50RouteProps,
} from "@/components/roleplay/GrokFirstV50RoleplayPage";

export const dynamic = "force-dynamic";

export default function AdeccoRoleplayV50Route(props: GrokFirstV50RouteProps) {
  return <GrokFirstV50RoleplayPage {...props} />;
}
