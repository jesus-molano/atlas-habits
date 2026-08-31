const REQUIRED_ENVIRONMENT_VARIABLES = [
  'EXPO_PUBLIC_FIREBASE_API_KEY',
  'EXPO_PUBLIC_FIREBASE_PROJECT_ID',
  'EXPO_PUBLIC_FIREBASE_APP_ID',
  'EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID',
] as const;

export type FirebasePublicConfig = Readonly<{
  apiKey: string;
  authDomain?: string;
  projectId: string;
  appId: string;
  messagingSenderId?: string;
  googleWebClientId: string;
  expectedOwnerUid?: string;
}>;

export type FirebasePublicConfigResolution =
  | Readonly<{ status: 'configured'; config: FirebasePublicConfig }>
  | Readonly<{
      status: 'not-configured' | 'incomplete-config';
      missingEnvironmentVariables: readonly string[];
    }>;

function clean(value: string | undefined): string | undefined {
  const normalized = value?.trim();
  return normalized ? normalized : undefined;
}

/**
 * Expo requires every public variable to use a static dot-property access so
 * Metro can inline it. These values are public Firebase identifiers, not
 * server credentials or private keys.
 */
export function readFirebasePublicConfig(): FirebasePublicConfigResolution {
  const apiKey = clean(process.env.EXPO_PUBLIC_FIREBASE_API_KEY);
  const authDomain = clean(process.env.EXPO_PUBLIC_FIREBASE_AUTH_DOMAIN);
  const projectId = clean(process.env.EXPO_PUBLIC_FIREBASE_PROJECT_ID);
  const appId = clean(process.env.EXPO_PUBLIC_FIREBASE_APP_ID);
  const messagingSenderId = clean(
    process.env.EXPO_PUBLIC_FIREBASE_MESSAGING_SENDER_ID,
  );
  const googleWebClientId = clean(process.env.EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID);
  const expectedOwnerUid = clean(process.env.EXPO_PUBLIC_FIREBASE_OWNER_UID);

  const requiredValues = { apiKey, projectId, appId, googleWebClientId };
  const configuredCount = Object.values(requiredValues).filter(Boolean).length;
  if (
    configuredCount === 0 &&
    !authDomain &&
    !messagingSenderId &&
    !expectedOwnerUid
  ) {
    return {
      status: 'not-configured',
      missingEnvironmentVariables: REQUIRED_ENVIRONMENT_VARIABLES,
    };
  }

  const missingEnvironmentVariables = REQUIRED_ENVIRONMENT_VARIABLES.filter(
    (name) => {
      switch (name) {
        case 'EXPO_PUBLIC_FIREBASE_API_KEY':
          return !apiKey;
        case 'EXPO_PUBLIC_FIREBASE_PROJECT_ID':
          return !projectId;
        case 'EXPO_PUBLIC_FIREBASE_APP_ID':
          return !appId;
        case 'EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID':
          return !googleWebClientId;
      }
    },
  );
  if (missingEnvironmentVariables.length > 0) {
    return { status: 'incomplete-config', missingEnvironmentVariables };
  }

  return {
    status: 'configured',
    config: {
      apiKey: apiKey!,
      ...(authDomain ? { authDomain } : {}),
      projectId: projectId!,
      appId: appId!,
      ...(messagingSenderId ? { messagingSenderId } : {}),
      googleWebClientId: googleWebClientId!,
      ...(expectedOwnerUid ? { expectedOwnerUid } : {}),
    },
  };
}
