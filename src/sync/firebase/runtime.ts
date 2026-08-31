import type { FirebaseApp } from 'firebase/app';
import type { Auth, Persistence } from 'firebase/auth';
import type { Firestore } from 'firebase/firestore';

import type { FirebasePublicConfig } from './config';

type AsyncStorageLike = {
  setItem(key: string, value: string): Promise<void>;
  getItem(key: string): Promise<string | null>;
  removeItem(key: string): Promise<void>;
};

type AuthApi = typeof import('firebase/auth');
type AuthApiWithReactNativePersistence = AuthApi & {
  getReactNativePersistence?: (storage: AsyncStorageLike) => Persistence;
};

export type FirebaseRuntime = Readonly<{
  app: FirebaseApp;
  auth: Auth;
  firestore: Firestore;
  authApi: AuthApi;
  firestoreApi: typeof import('firebase/firestore');
}>;

export type GetFirebaseRuntime = () => Promise<FirebaseRuntime>;

const FIREBASE_APP_NAME = 'atlas-optional-sync';

function isAlreadyInitialized(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as { code?: unknown }).code === 'auth/already-initialized'
  );
}

export function createFirebaseRuntimeLoader(
  config: FirebasePublicConfig,
): GetFirebaseRuntime {
  let pending: Promise<FirebaseRuntime> | null = null;

  return () => {
    pending ??= (async () => {
      const [appApi, authApiImport, firestoreApi, asyncStorageImport] =
        await Promise.all([
          import('firebase/app'),
          import('firebase/auth'),
          import('firebase/firestore'),
          import('@react-native-async-storage/async-storage'),
        ]);
      const authApi = authApiImport as AuthApiWithReactNativePersistence;
      const existing = appApi
        .getApps()
        .find((candidate) => candidate.name === FIREBASE_APP_NAME);
      const app =
        existing ??
        appApi.initializeApp(
          {
            apiKey: config.apiKey,
            ...(config.authDomain ? { authDomain: config.authDomain } : {}),
            projectId: config.projectId,
            appId: config.appId,
            ...(config.messagingSenderId
              ? { messagingSenderId: config.messagingSenderId }
              : {}),
          },
          FIREBASE_APP_NAME,
        );

      let auth: Auth;
      const persistenceFactory = authApi.getReactNativePersistence;
      if (persistenceFactory) {
        try {
          auth = authApi.initializeAuth(app, {
            persistence: persistenceFactory(asyncStorageImport.default),
          });
        } catch (error) {
          if (!isAlreadyInitialized(error)) throw error;
          auth = authApi.getAuth(app);
        }
      } else {
        auth = authApi.getAuth(app);
      }

      return {
        app,
        auth,
        firestore: firestoreApi.getFirestore(app),
        authApi,
        firestoreApi,
      };
    })();
    return pending;
  };
}
