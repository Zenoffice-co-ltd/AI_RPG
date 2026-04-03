import { playbookNormsSchema, type PlaybookNorms } from "@top-performer/domain";
import type { Firestore } from "firebase-admin/firestore";
import { createConverter } from "../converters/createConverter";

const playbookConverter = createConverter(playbookNormsSchema);

export class PlaybookRepository {
  constructor(private readonly firestore: Firestore) {}

  async upsert(playbook: PlaybookNorms): Promise<void> {
    const parsed = playbookNormsSchema.parse(playbook);
    await this.firestore
      .collection("playbooks")
      .doc(parsed.version)
      .withConverter(playbookConverter)
      .set(parsed, { merge: true });
  }

  async get(version: string): Promise<PlaybookNorms | null> {
    const snapshot = await this.firestore
      .collection("playbooks")
      .doc(version)
      .withConverter(playbookConverter)
      .get();
    return snapshot.exists ? snapshot.data() ?? null : null;
  }

  async list(): Promise<PlaybookNorms[]> {
    const snapshot = await this.firestore
      .collection("playbooks")
      .orderBy("generatedAt", "desc")
      .withConverter(playbookConverter)
      .get();

    return snapshot.docs.map((doc) => doc.data());
  }
}
