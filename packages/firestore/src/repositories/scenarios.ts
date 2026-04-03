import {
  compiledScenarioAssetsSchema,
  scenarioPackSchema,
  type CompiledScenarioAssets,
  type ScenarioPack,
} from "@top-performer/domain";
import type { Firestore } from "firebase-admin/firestore";
import { createConverter } from "../converters/createConverter";

const scenarioConverter = createConverter(scenarioPackSchema);
const assetConverter = createConverter(compiledScenarioAssetsSchema);

export class ScenarioRepository {
  constructor(private readonly firestore: Firestore) {}

  async upsert(scenario: ScenarioPack): Promise<void> {
    const parsed = scenarioPackSchema.parse(scenario);
    await this.firestore
      .collection("scenarios")
      .doc(parsed.id)
      .withConverter(scenarioConverter)
      .set(parsed, { merge: true });
  }

  async get(scenarioId: string): Promise<ScenarioPack | null> {
    const snapshot = await this.firestore
      .collection("scenarios")
      .doc(scenarioId)
      .withConverter(scenarioConverter)
      .get();
    return snapshot.exists ? snapshot.data() ?? null : null;
  }

  async listPublished(): Promise<ScenarioPack[]> {
    const snapshot = await this.firestore
      .collection("scenarios")
      .where("status", "==", "published")
      .withConverter(scenarioConverter)
      .get();
    return snapshot.docs.map((doc) => doc.data());
  }

  async listAll(): Promise<ScenarioPack[]> {
    const snapshot = await this.firestore
      .collection("scenarios")
      .orderBy("version", "desc")
      .withConverter(scenarioConverter)
      .get();
    return snapshot.docs.map((doc) => doc.data());
  }

  async saveAssets(assets: CompiledScenarioAssets): Promise<void> {
    const parsed = compiledScenarioAssetsSchema.parse(assets);
    await this.firestore
      .collection("scenarios")
      .doc(parsed.scenarioId)
      .collection("artifacts")
      .doc("compiled_assets")
      .withConverter(assetConverter)
      .set(parsed, { merge: true });
  }

  async getAssets(scenarioId: string): Promise<CompiledScenarioAssets | null> {
    const snapshot = await this.firestore
      .collection("scenarios")
      .doc(scenarioId)
      .collection("artifacts")
      .doc("compiled_assets")
      .withConverter(assetConverter)
      .get();

    return snapshot.exists ? snapshot.data() ?? null : null;
  }
}
