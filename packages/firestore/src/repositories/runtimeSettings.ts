import { runtimeSettingsSchema } from "@top-performer/domain";
import type { Firestore } from "firebase-admin/firestore";
import { createConverter } from "../converters/createConverter";

const runtimeSettingsConverter = createConverter(runtimeSettingsSchema);

export class RuntimeSettingsRepository {
  constructor(private readonly firestore: Firestore) {}

  async get() {
    const snapshot = await this.firestore
      .collection("settings")
      .doc("runtime")
      .withConverter(runtimeSettingsConverter)
      .get();

    return snapshot.exists ? snapshot.data() ?? null : null;
  }

  async set(settings: Parameters<typeof runtimeSettingsSchema.parse>[0]) {
    const parsed = runtimeSettingsSchema.parse(settings);
    await this.firestore
      .collection("settings")
      .doc("runtime")
      .withConverter(runtimeSettingsConverter)
      .set(parsed, { merge: true });
  }
}
