import { AdminActionCard } from "@/components/admin/AdminActionCard";
import {
  BUILTIN_SCENARIO_SUMMARIES,
  PUBLISHABLE_SCENARIO_IDS,
} from "@top-performer/domain";

export default function AdminAgentsPage() {
  return (
    <main className="min-h-screen px-5 py-6 md:px-8">
      <div className="mx-auto grid max-w-5xl gap-5">
        {PUBLISHABLE_SCENARIO_IDS.map((scenarioId) => {
          const scenario = BUILTIN_SCENARIO_SUMMARIES.find(
            (item) => item.id === scenarioId
          );
          return (
            <AdminActionCard
              key={scenarioId}
              title={`Publish ${scenario?.title ?? scenarioId}`}
              description="knowledge base document、agent config、staging branch、tests を更新し、pass 時に binding を保存します。"
              endpoint={`/api/admin/scenarios/${scenarioId}/publish`}
              payload={{ scenarioId }}
              buttonLabel="Publish Scenario"
            />
          );
        })}
      </div>
    </main>
  );
}
