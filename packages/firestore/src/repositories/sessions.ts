import {
  scorecardSchema,
  sessionArtifactSchema,
  sessionRecordSchema,
  sessionTurnSchema,
  type Scorecard,
  type SessionArtifact,
  type SessionRecord,
  type SessionTurn,
} from "@top-performer/domain";
import type { Firestore } from "firebase-admin/firestore";
import { createConverter } from "../converters/createConverter";

const sessionConverter = createConverter(sessionRecordSchema);
const turnConverter = createConverter(sessionTurnSchema);
const artifactConverter = createConverter(sessionArtifactSchema);
const scorecardConverter = createConverter(scorecardSchema);

export function decideAnalysisTransition(status: SessionRecord["status"]) {
  if (status === "completed" || status === "analysis_running") {
    return {
      lockAcquired: false,
      nextStatus: status,
    } as const;
  }

  return {
    lockAcquired: true,
    nextStatus: "analysis_running",
  } as const;
}

export class SessionRepository {
  constructor(private readonly firestore: Firestore) {}

  async create(session: SessionRecord): Promise<void> {
    const parsed = sessionRecordSchema.parse(session);
    await this.firestore
      .collection("sessions")
      .doc(parsed.sessionId)
      .withConverter(sessionConverter)
      .set(parsed);
  }

  async get(sessionId: string): Promise<SessionRecord | null> {
    const snapshot = await this.firestore
      .collection("sessions")
      .doc(sessionId)
      .withConverter(sessionConverter)
      .get();
    return snapshot.exists ? snapshot.data() ?? null : null;
  }

  async update(
    sessionId: string,
    patch: Partial<SessionRecord>
  ): Promise<void> {
    await this.firestore.collection("sessions").doc(sessionId).set(patch, {
      merge: true,
    });
  }

  async transitionToAnalysisRunning(
    sessionId: string
  ): Promise<{ session: SessionRecord; lockAcquired: boolean } | null> {
    return this.firestore.runTransaction(async (transaction) => {
      const ref = this.firestore.collection("sessions").doc(sessionId);
      const snapshot = await transaction.get(ref.withConverter(sessionConverter));
      if (!snapshot.exists) {
        return null;
      }

      const session = snapshot.data();
      if (!session) {
        return null;
      }

      const decision = decideAnalysisTransition(session.status);
      if (!decision.lockAcquired) {
        return {
          session,
          lockAcquired: false,
        };
      }

      transaction.set(
        ref,
        {
          status: decision.nextStatus,
        } satisfies Partial<SessionRecord>,
        { merge: true }
      );

      return {
        session: {
          ...session,
          status: decision.nextStatus,
        },
        lockAcquired: true,
      };
    });
  }

  async upsertTurns(sessionId: string, turns: SessionTurn[]): Promise<void> {
    const batch = this.firestore.batch();
    const turnsCollection = this.firestore
      .collection("sessions")
      .doc(sessionId)
      .collection("turns");

    for (const turn of turns) {
      const parsed = sessionTurnSchema.parse(turn);
      batch.set(
        turnsCollection.doc(parsed.turnId).withConverter(turnConverter),
        parsed,
        { merge: true }
      );
    }

    await batch.commit();
  }

  async listTurns(sessionId: string): Promise<SessionTurn[]> {
    const snapshot = await this.firestore
      .collection("sessions")
      .doc(sessionId)
      .collection("turns")
      .orderBy("relativeTimestamp", "asc")
      .withConverter(turnConverter)
      .get();

    return snapshot.docs.map((doc) => doc.data());
  }

  async saveArtifact(artifact: SessionArtifact): Promise<void> {
    const parsed = sessionArtifactSchema.parse(artifact);
    await this.firestore
      .collection("sessions")
      .doc(parsed.sessionId)
      .collection("artifacts")
      .doc(parsed.id)
      .withConverter(artifactConverter)
      .set(parsed, { merge: true });
  }

  async getArtifact(
    sessionId: string,
    artifactId: string
  ): Promise<SessionArtifact | null> {
    const snapshot = await this.firestore
      .collection("sessions")
      .doc(sessionId)
      .collection("artifacts")
      .doc(artifactId)
      .withConverter(artifactConverter)
      .get();

    return snapshot.exists ? snapshot.data() ?? null : null;
  }

  async saveScorecard(scorecard: Scorecard): Promise<void> {
    const parsed = scorecardSchema.parse(scorecard);
    await this.firestore
      .collection("sessions")
      .doc(parsed.sessionId)
      .collection("artifacts")
      .doc("scorecard")
      .withConverter(scorecardConverter)
      .set(parsed, { merge: true });
  }

  async getScorecard(sessionId: string): Promise<Scorecard | null> {
    const snapshot = await this.firestore
      .collection("sessions")
      .doc(sessionId)
      .collection("artifacts")
      .doc("scorecard")
      .withConverter(scorecardConverter)
      .get();

    return snapshot.exists ? snapshot.data() ?? null : null;
  }
}
