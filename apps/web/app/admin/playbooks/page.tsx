import { AdminActionCard } from "@/components/admin/AdminActionCard";

export default function AdminPlaybooksPage() {
  return (
    <main className="min-h-screen px-5 py-6 md:px-8">
      <div className="mx-auto grid max-w-5xl gap-5">
        <AdminActionCard
          title="Build Playbook"
          description="transcript extraction を OpenAI Structured Outputs で実行し、frequency aggregation から Playbook Norms を生成します。"
          endpoint="/api/admin/playbooks/build"
          payload={{ family: "staffing_order_hearing" }}
          buttonLabel="Build Playbook"
        />
        <AdminActionCard
          title="Build Accounting Norms v2"
          description="Gold corpus を前提に accounting family の norms v2 を生成します。"
          endpoint="/api/admin/playbooks/build"
          payload={{ family: "accounting_clerk_enterprise_ap", mode: "v2" }}
          buttonLabel="Build Accounting Norms"
        />
      </div>
    </main>
  );
}
