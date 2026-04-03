import { agentBindingSchema, type AgentBinding } from "@top-performer/domain";
import type { Firestore } from "firebase-admin/firestore";
import { createConverter } from "../converters/createConverter";

const bindingConverter = createConverter(agentBindingSchema);

export class AgentBindingRepository {
  constructor(private readonly firestore: Firestore) {}

  async upsert(binding: AgentBinding): Promise<void> {
    const parsed = agentBindingSchema.parse(binding);
    await this.firestore
      .collection("agentBindings")
      .doc(parsed.scenarioId)
      .withConverter(bindingConverter)
      .set(parsed, { merge: true });
  }

  async get(scenarioId: string): Promise<AgentBinding | null> {
    const snapshot = await this.firestore
      .collection("agentBindings")
      .doc(scenarioId)
      .withConverter(bindingConverter)
      .get();

    return snapshot.exists ? snapshot.data() ?? null : null;
  }
}
