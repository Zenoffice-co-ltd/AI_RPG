import {
  canonicalTranscriptSchema,
  corpusManifestSchema,
  derivedArtifactEnvelopeSchema,
  familySchema,
  transcriptSourceRecordSchema,
  transcriptBehaviorExtractionSchema,
  transcriptRecordSchema,
  type CanonicalTranscript,
  type CorpusManifest,
  type DerivedArtifactEnvelope,
  type TranscriptBehaviorExtraction,
  type TranscriptRecord,
  type TranscriptSourceRecord,
} from "@top-performer/domain";
import type { Firestore } from "firebase-admin/firestore";
import { createConverter } from "../converters/createConverter";

const transcriptConverter = createConverter(transcriptRecordSchema);
const extractionConverter = createConverter(transcriptBehaviorExtractionSchema);
const sourceRecordConverter = createConverter(transcriptSourceRecordSchema);
const manifestConverter = createConverter(corpusManifestSchema);
const canonicalTranscriptConverter = createConverter(canonicalTranscriptSchema);
const derivedArtifactConverter = createConverter(derivedArtifactEnvelopeSchema);

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

  async upsertSourceRecord(record: TranscriptSourceRecord): Promise<void> {
    const parsed = transcriptSourceRecordSchema.parse(record);
    await this.firestore
      .collection("transcriptSourceRecords")
      .doc(parsed.id)
      .withConverter(sourceRecordConverter)
      .set(parsed, { merge: true });
  }

  async listSourceRecords(): Promise<TranscriptSourceRecord[]> {
    const snapshot = await this.firestore
      .collection("transcriptSourceRecords")
      .orderBy("excelRow", "asc")
      .withConverter(sourceRecordConverter)
      .get();

    return snapshot.docs.map((doc) => doc.data());
  }

  async saveCorpusManifest(manifest: CorpusManifest): Promise<void> {
    const parsed = corpusManifestSchema.parse(manifest);
    await this.firestore
      .collection("corpusManifests")
      .doc(parsed.corpusId)
      .withConverter(manifestConverter)
      .set(parsed, { merge: true });
  }

  async getCorpusManifest(corpusId: string): Promise<CorpusManifest | null> {
    const snapshot = await this.firestore
      .collection("corpusManifests")
      .doc(corpusId)
      .withConverter(manifestConverter)
      .get();

    return snapshot.exists ? snapshot.data() ?? null : null;
  }

  async upsertCanonicalTranscript(record: CanonicalTranscript): Promise<void> {
    const parsed = canonicalTranscriptSchema.parse(record);
    await this.firestore
      .collection("canonicalTranscripts")
      .doc(parsed.id)
      .withConverter(canonicalTranscriptConverter)
      .set(parsed, { merge: true });
  }

  async listCanonicalTranscripts(input?: {
    corpusId?: string;
    ids?: string[];
    tiers?: Array<"gold" | "silver" | "reject">;
  }): Promise<CanonicalTranscript[]> {
    let query:
      | FirebaseFirestore.Query<CanonicalTranscript>
      | FirebaseFirestore.CollectionReference<CanonicalTranscript> =
      this.firestore
        .collection("canonicalTranscripts")
        .withConverter(canonicalTranscriptConverter);

    if (input?.corpusId) {
      query = query.where("corpusId", "==", input.corpusId);
    }

    if (input?.tiers && input.tiers.length === 1) {
      query = query.where("qualityTier", "==", input.tiers[0]);
    }

    const snapshot = await query.get();
    let records = snapshot.docs.map((doc) => doc.data());

    if (input?.tiers && input.tiers.length > 1) {
      const tiers = new Set(input.tiers);
      records = records.filter((record) => tiers.has(record.qualityTier));
    }

    if (input?.ids && input.ids.length > 0) {
      const ids = new Set(input.ids);
      records = records.filter((record) => ids.has(record.id));
    }

    return records;
  }

  async saveDerivedArtifact(artifact: DerivedArtifactEnvelope): Promise<void> {
    const parsed = derivedArtifactEnvelopeSchema.parse(artifact);
    await this.firestore
      .collection("canonicalTranscripts")
      .doc(parsed.transcriptId)
      .collection("derivedArtifacts")
      .doc(parsed.kind)
      .withConverter(derivedArtifactConverter)
      .set(parsed, { merge: true });
  }

  async listDerivedArtifacts(
    transcriptId: string
  ): Promise<DerivedArtifactEnvelope[]> {
    const snapshot = await this.firestore
      .collection("canonicalTranscripts")
      .doc(transcriptId)
      .collection("derivedArtifacts")
      .withConverter(derivedArtifactConverter)
      .get();

    return snapshot.docs.map((doc) => doc.data());
  }
}
