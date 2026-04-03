import {
  familySchema,
  transcriptBehaviorExtractionSchema,
  transcriptRecordSchema,
  type TranscriptBehaviorExtraction,
  type TranscriptRecord,
} from "@top-performer/domain";
import type { Firestore } from "firebase-admin/firestore";
import { createConverter } from "../converters/createConverter";

const transcriptConverter = createConverter(transcriptRecordSchema);
const extractionConverter = createConverter(transcriptBehaviorExtractionSchema);

export class TranscriptRepository {
  constructor(private readonly firestore: Firestore) {}

  async upsert(record: TranscriptRecord): Promise<void> {
    const parsed = transcriptRecordSchema.parse(record);
    await this.firestore
      .collection("transcripts")
      .doc(parsed.id)
      .withConverter(transcriptConverter)
      .set(parsed, { merge: true });
  }

  async get(transcriptId: string): Promise<TranscriptRecord | null> {
    const snapshot = await this.firestore
      .collection("transcripts")
      .doc(transcriptId)
      .withConverter(transcriptConverter)
      .get();

    return snapshot.exists ? snapshot.data() ?? null : null;
  }

  async listByFamily(family: string): Promise<TranscriptRecord[]> {
    const parsedFamily = familySchema.parse(family);
    const snapshot = await this.firestore
      .collection("transcripts")
      .where("family", "==", parsedFamily)
      .withConverter(transcriptConverter)
      .get();

    return snapshot.docs.map((doc) => doc.data());
  }

  async saveExtraction(extraction: TranscriptBehaviorExtraction): Promise<void> {
    const parsed = transcriptBehaviorExtractionSchema.parse(extraction);
    await this.firestore
      .collection("transcripts")
      .doc(parsed.transcriptId)
      .collection("artifacts")
      .doc("behavior_extraction")
      .withConverter(extractionConverter)
      .set(parsed, { merge: true });
  }

  async getExtraction(
    transcriptId: string
  ): Promise<TranscriptBehaviorExtraction | null> {
    const snapshot = await this.firestore
      .collection("transcripts")
      .doc(transcriptId)
      .collection("artifacts")
      .doc("behavior_extraction")
      .withConverter(extractionConverter)
      .get();

    return snapshot.exists ? snapshot.data() ?? null : null;
  }
}
