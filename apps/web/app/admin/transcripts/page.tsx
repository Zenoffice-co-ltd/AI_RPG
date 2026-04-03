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
      </div>
    </main>
  );
}
