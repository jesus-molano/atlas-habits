# Optional Firebase sync

Atlas remains fully usable without Firebase. The adapter initializes only when
all required `EXPO_PUBLIC_*` values exist. It uses Firebase Authentication and
Cloud Firestore only. Analytics, Functions, and Storage are not used.

## One-time setup

1. Create a Firebase project on the Spark plan and one Firestore database.
2. Enable Google in **Authentication > Sign-in method**.
3. Register the Android app with package `atlas_habits.com`. Add the SHA-1
   and SHA-256 fingerprints of the signing certificate.
4. Download `google-services.json`. Keep the downloaded file out of Git.
5. Create or locate the OAuth client whose type is **Web application**. Put its
   client ID in `EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID`; do not use the Android
   client ID there.
6. Copy `.env.example` to `.env.local` and fill the public identifiers. These
   identifiers are embedded in the APK and are not secrets. Never put a service
   account key, OAuth client secret, or private key in an `EXPO_PUBLIC_*` value.
7. Set `ATLAS_GOOGLE_SERVICES_FILE` to the path of the downloaded JSON. The
   Expo app config uses this build-time value to set `android.googleServicesFile`
   and enable the `@react-native-google-signin/google-signin` config plugin.
   Rebuild the native app; Google Sign-In does not work in Expo Go.
8. Deploy from this directory:

   ```sh
   cd firebase
   npx firebase-tools login
   npx firebase-tools use YOUR_FIREBASE_PROJECT_ID
   npx firebase-tools deploy --only firestore
   ```

The checked-in rules accept only Firebase sessions created with Google. They
require `request.auth.uid` to match the `users/{userId}` path, so every account
can read and append data only inside its own namespace. Device registrations
and segments remain immutable after creation. On the Spark plan an abusive
account can consume free quota in its own namespace, but it cannot access
another account's data or create billable usage.

## Remote layout

```text
users/{userUid}/devices/{deviceId}
users/{userUid}/devices/{deviceId}/segments/{firstSeq}
```

Device registrations and segments are create-only. Each segment contains
canonical JSON plus a SHA-256 content hash and the previous segment hash. A
retry reads the deterministic range document first: identical content is a
successful no-op, while different content is a conflict. Pulls list the small
device registry and query only segments after `lastSeqByDevice[deviceId]`.

SQLite remains the source of truth. Firestore offline persistence and realtime
listeners are intentionally not used.
