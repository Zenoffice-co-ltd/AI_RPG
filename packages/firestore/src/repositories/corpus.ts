import {
  canonicalTranscriptSchema,
  corpusManifestSchema,
  derivedArtifactEnvelopeSchema,
  scenarioPackV2Schema,
  transcriptSourceRecordSchema,
  type CanonicalTranscript,
  type CorpusManifest,
  type DerivedArtifactEnvelope,
  type ScenarioPackV2,
  type TranscriptSourceRecord,
} from "@top-performer/domain";
import type { Firestore } from "firebase-admin/firestore";
import { createConverter } from "../converters/createConverter";

const sourceRecordConverter = createConverter(transcriptSourceRecordSchema);
const canonicalTranscriptConverter = createConverter(canonicalTranscriptSchema);
const corpusManifestConverter = createConverter(corpusManifestSchema);
const derivedArtifactConverter = createConverter(derivedArtifactEnvelopeSchema);
const scenarioPackV2Converter = createConverter(scenarioPackV2Schema);

export class CorpusRepository {
  constructor(private readonly firestore: Firestore) {}

  async upsertSourceRecord(record: TranscriptSourceRecord): Promise<void> {
    const parsed = transcriptSourceRecordSchema.parse(record);
    await this.firestore
      .collection("transcriptSourceRecords")
      .doc(parsed.id)
      .withConverter(sourceRecordConverter)
      .set(parsed, { merge: true });
  }

  async upsertCanonicalTranscript(record: CanonicalTranscript): Promise<void> {
    const parsed = canonicalTranscriptSchema.parse(record);
    await this.firestore
      .collection("canonicalTranscripts")
      .doc(parsed.id)
      .withConverter(canonicalTranscriptConverter)
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

  async listCanonicalTranscriptsByCorpus(
    corpusId: string
  ): Promise<CanonicalTranscript[]> {
    const snapshot = await this.firestore
      .collection("canonicalTranscripts")
      .where("corpusId", "==", corpusId)
      .withConverter(canonicalTranscriptConverter)
      .get();

    return snapshot.docs.map((doc) => doc.data());
  }

  async saveManifest(manifest: CorpusManifest): Promise<void> {
    const parsed = corpusManifestSchema.parse(manifest);
    await this.firestore
      .collection("corpusManifests")
      .doc(parsed.corpusId)
      .withConverter(corpusManifestConverter)
      .set(parsed, { merge: true });
  }

  async getManifest(manifestId: string): Promise<CorpusManifest | null> {
    const snapshot = await this.firestore
      .collection("corpusManifests")
      .doc(manifestId)
      .withConverter(corpusManifestConverter)
      .get();

    return snapshot.exists ? snapshot.data() ?? null : null;
  }

  async saveDerivedArtifact(artifact: DerivedArtifactEnvelope): Promise<void> {
    const parsed = derivedArtifactEnvelopeSchema.parse(artifact);
    await this.firestore
      .collection("canonicalTranscripts")
      .doc(parsed.transcriptId)
      .collection("artifactsV2")
      .doc(parsed.kind)
      .withConverter(derivedArtifactConverter)
      .set(parsed, { merge: true });
  }

  async upsertScenarioPackV2(pack: ScenarioPackV2): Promise<void> {
    const parsed = scenarioPackV2Schema.parse(pack);
    await this.firestore
      .collection("scenarioPacksV2")
      .doc(parsed.id)
      .withConverter(scenarioPackV2Converter)
      .set(parsed, { merge: true });
  }
}
