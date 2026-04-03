import { applicationDefault } from "firebase-admin/app";
import { SecretManagerServiceClient } from "@google-cloud/secret-manager";

export const DEFAULT_SECRET_SOURCE_PROJECT_ID = "zapier-transfer";
export const DEFAULT_OPENAI_SECRET_NAME = "openai-api-key-default";
export const FIXED_TENANT_NAME = "adecco";

let secretManagerClientSingleton: SecretManagerServiceClient | null = null;

function getSecretManagerClient() {
  secretManagerClientSingleton ??= new SecretManagerServiceClient();
  return secretManagerClientSingleton;
}

export function trimConfiguredValue(value?: string | null) {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

export async function accessSecretValue(
  secretName: string,
  secretProjectId: string,
  version = "latest"
) {
  const client = getSecretManagerClient();
  const [response] = await client.accessSecretVersion({
    name: client.secretVersionPath(secretProjectId, secretName, version),
  });
  const value = trimConfiguredValue(response.payload?.data?.toString("utf8"));

  if (!value) {
    throw new Error(
      `Secret projects/${secretProjectId}/secrets/${secretName} resolved to an empty value.`
    );
  }

  return value;
}

export async function secretExists(
  secretName: string,
  secretProjectId: string
) {
  const client = getSecretManagerClient();

  try {
    await client.getSecret({
      name: client.secretPath(secretProjectId, secretName),
    });
    return true;
  } catch (error) {
    if (
      error instanceof Error &&
      "code" in error &&
      (error.code === 5 || error.code === 404)
    ) {
      return false;
    }

    throw error;
  }
}

export async function getEnvOrSecret(
  envName: string,
  secretName: string,
  secretProjectId: string,
  source: Record<string, string | undefined> = process.env
) {
  const envValue = trimConfiguredValue(source[envName]);
  if (envValue) {
    return envValue;
  }

  try {
    return await accessSecretValue(secretName, secretProjectId);
  } catch (error) {
    const detail = error instanceof Error ? error.message : "Unknown secret error";
    throw new Error(
      `Missing ${envName}: env was unset and secret projects/${secretProjectId}/secrets/${secretName} could not be used. ${detail}`
    );
  }
}

export async function hasApplicationDefaultCredentials() {
  try {
    const token = await applicationDefault().getAccessToken();
    return Boolean(trimConfiguredValue(token.access_token));
  } catch {
    return false;
  }
}
