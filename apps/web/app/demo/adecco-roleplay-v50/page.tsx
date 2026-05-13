import {
  GrokFirstV50RoleplayPage,
  type GrokFirstV50PageProps,
} from "@/components/roleplay/GrokFirstV50RoleplayPage";

export const dynamic = "force-dynamic";

export default function AdeccoRoleplayV50Route(props: GrokFirstV50PageProps) {
  return <GrokFirstV50RoleplayPage {...props} />;
}
