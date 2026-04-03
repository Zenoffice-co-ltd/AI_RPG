import type {
  DocumentData,
  FirestoreDataConverter,
  QueryDocumentSnapshot,
} from "firebase-admin/firestore";
import type { z } from "zod";

export function createConverter<TSchema extends z.ZodType>(schema: TSchema): FirestoreDataConverter<z.infer<TSchema>> {
  return {
    toFirestore(modelObject) {
      return schema.parse(modelObject) as DocumentData;
    },
    fromFirestore(snapshot: QueryDocumentSnapshot) {
      return schema.parse(snapshot.data());
    },
  };
}
