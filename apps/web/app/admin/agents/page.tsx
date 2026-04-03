import { AdminActionCard } from "@/components/admin/AdminActionCard";

export default function AdminAgentsPage() {
  return (
    <main className="min-h-screen px-5 py-6 md:px-8">
      <div className="mx-auto grid max-w-5xl gap-5">
        <AdminActionCard
          title="Publish Scenario Agent"
          description="knowledge base document、agent config、staging branch、tests を更新し、pass 時に binding を保存します。"
          endpoint="/api/admin/scenarios/staffing_order_hearing_busy_manager_medium/publish"
          payload={{ scenarioId: "staffing_order_hearing_busy_manager_medium" }}
          buttonLabel="Publish Scenario"
        />
      </div>
    </main>
  );
}
