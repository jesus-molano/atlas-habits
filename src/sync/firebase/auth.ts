import type { User } from 'firebase/auth';

import { SyncAuthenticationError } from '../errors';
import type { SyncAuthAdapter, SyncUser } from '../types';

import type { FirebasePublicConfig } from './config';
import type { FirebaseRuntime, GetFirebaseRuntime } from './runtime';

type GoogleSignInApi =
  typeof import('@react-native-google-signin/google-signin');

function toSyncUser(user: User): SyncUser {
  return {
    uid: user.uid,
    displayName: user.displayName,
    email: user.email,
    photoUrl: user.photoURL,
  };
}

export class FirebaseGoogleAuthAdapter implements SyncAuthAdapter {
  readonly providerId = 'firebase-google';
  private googleApiPromise: Promise<GoogleSignInApi> | null = null;

  constructor(
    private readonly getRuntime: GetFirebaseRuntime,
    private readonly config: FirebasePublicConfig,
  ) {}

  private async getGoogleApi(): Promise<GoogleSignInApi> {
    this.googleApiPromise ??=
      import('@react-native-google-signin/google-signin').then((api) => {
        api.GoogleSignin.configure({
          webClientId: this.config.googleWebClientId,
          offlineAccess: false,
        });
        return api;
      });
    return this.googleApiPromise;
  }

  private assertExpectedOwner(user: User): void {
    if (
      this.config.expectedOwnerUid &&
      user.uid !== this.config.expectedOwnerUid
    ) {
      throw new SyncAuthenticationError(
        `Google account resolved to Firebase UID ${user.uid}, not the configured owner UID.`,
      );
    }
  }

  private async exchangeIdToken(
    runtime: FirebaseRuntime,
    idToken: string | null,
  ): Promise<SyncUser> {
    if (!idToken) {
      throw new SyncAuthenticationError(
        'Google did not return an ID token. Check EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID.',
      );
    }
    const credential = runtime.authApi.GoogleAuthProvider.credential(idToken);
    const result = await runtime.authApi.signInWithCredential(
      runtime.auth,
      credential,
    );
    try {
      this.assertExpectedOwner(result.user);
    } catch (error) {
      await runtime.authApi.signOut(runtime.auth);
      throw error;
    }
    return toSyncUser(result.user);
  }

  async getSession(): Promise<SyncUser | null> {
    const runtime = await this.getRuntime();
    await runtime.auth.authStateReady();
    if (!runtime.auth.currentUser) return null;
    this.assertExpectedOwner(runtime.auth.currentUser);
    return toSyncUser(runtime.auth.currentUser);
  }

  async restoreSession(): Promise<SyncUser | null> {
    const existing = await this.getSession();
    if (existing) return existing;

    const googleApi = await this.getGoogleApi();
    if (!googleApi.GoogleSignin.hasPreviousSignIn()) return null;
    const response = await googleApi.GoogleSignin.signInSilently();
    if (response.type !== 'success') return null;
    return this.exchangeIdToken(await this.getRuntime(), response.data.idToken);
  }

  async signIn(): Promise<SyncUser | null> {
    const googleApi = await this.getGoogleApi();
    await googleApi.GoogleSignin.hasPlayServices({
      showPlayServicesUpdateDialog: true,
    });
    const response = await googleApi.GoogleSignin.signIn();
    if (!googleApi.isSuccessResponse(response)) return null;
    return this.exchangeIdToken(await this.getRuntime(), response.data.idToken);
  }

  async signOut(): Promise<void> {
    const runtime = await this.getRuntime();
    await runtime.authApi.signOut(runtime.auth);
    const googleApi = await this.getGoogleApi();
    if (googleApi.GoogleSignin.hasPreviousSignIn())
      await googleApi.GoogleSignin.signOut();
  }
}
