import { applicationDefault, cert, getApps, initializeApp } from "firebase-admin/app";
import { getFirestore, type Firestore } from "firebase-admin/firestore";

export type FirestoreAdminConfig = {
  projectId?: string;
  clientEmail?: string;
  privateKey?: string;
};

let firestoreSingleton: Firestore | null = null;

export function getFirestoreAdmin(config: FirestoreAdminConfig = {}): Firestore {
  if (firestoreSingleton) {
    return firestoreSingleton;
  }

  const existingApp = getApps()[0];
  const credential =
    config.projectId && config.clientEmail && config.privateKey
      ? cert({
          projectId: config.projectId,
          clientEmail: config.clientEmail,
          privateKey: config.privateKey.replace(/\\n/g, "\n"),
        })
      : applicationDefault();
  const app =
    existingApp ??
    initializeApp({
      credential,
      ...(config.projectId ? { projectId: config.projectId } : {}),
    });

  firestoreSingleton = getFirestore(app);
  return firestoreSingleton;
}
