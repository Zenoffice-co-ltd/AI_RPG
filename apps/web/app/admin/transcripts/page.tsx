import { AdminActionCard } from "@/components/admin/AdminActionCard";

export default function AdminTranscriptsPage() {
  return (
    <main className="min-h-screen px-5 py-6 md:px-8">
      <div className="mx-auto grid max-w-5xl gap-5">
        <AdminActionCard
          title="Transcript Import"
          description="JSON / JSONL / CSV を取り込み、speaker 正規化・redaction・turn merge を行って Firestore と generated JSON に保存します。"
          endpoint="/api/admin/transcripts/import"
          payload={{ path: "./data/transcripts" }}
          buttonLabel="Import Transcripts"
        />
        <AdminActionCard
          title="Accounting Corpus Import v2"
          description="workbook から source registry / manifest / canonical transcript を生成します。"
          endpoint="/api/admin/transcripts/import"
          payload={{
            path: "C:\\Users\\yukih\\Downloads\\【ビースタイルスマートキャリア】トランスクリプト格納.xlsx",
            family: "accounting_clerk_enterprise_ap",
            mode: "v2",
            manifestPath:
              "./data/transcripts/corpora/enterprise_accounting_ap_gold_v1.manifest.json",
          }}
          buttonLabel="Import Accounting Corpus"
        />
      </div>
    </main>
  );
}
