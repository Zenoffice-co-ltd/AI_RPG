import { jobRecordSchema, type JobRecord } from "@top-performer/domain";
import type { Firestore } from "firebase-admin/firestore";
import { createConverter } from "../converters/createConverter";

const jobConverter = createConverter(jobRecordSchema);

export class JobRepository {
  constructor(private readonly firestore: Firestore) {}

  async upsert(job: JobRecord): Promise<void> {
    const parsed = jobRecordSchema.parse(job);
    await this.firestore
      .collection("jobs")
      .doc(parsed.jobId)
      .withConverter(jobConverter)
      .set(parsed, { merge: true });
  }

  async get(jobId: string): Promise<JobRecord | null> {
    const snapshot = await this.firestore
      .collection("jobs")
      .doc(jobId)
      .withConverter(jobConverter)
      .get();
    return snapshot.exists ? snapshot.data() ?? null : null;
  }
}
