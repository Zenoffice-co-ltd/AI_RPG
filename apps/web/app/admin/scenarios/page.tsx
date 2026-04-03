import { AdminActionCard } from "@/components/admin/AdminActionCard";

export default function AdminScenariosPage() {
  return (
    <main className="min-h-screen px-5 py-6 md:px-8">
      <div className="mx-auto grid max-w-5xl gap-5">
        <AdminActionCard
          title="Compile Scenarios"
          description="Playbook Norms から 3 variants の scenario pack と compiled assets を生成します。"
          endpoint="/api/admin/scenarios/compile"
          payload={{ playbookVersion: "pb_2026_04_02_v1" }}
          buttonLabel="Compile Scenarios"
        />
      </div>
    </main>
  );
}
