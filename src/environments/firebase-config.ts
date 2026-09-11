/**
 * Firebase client config — README.md "Firestore" / "Backend contract".
 *
 * This is NOT a secret. It's fine to ship in the browser bundle and commit
 * to the repo: it just tells the Firebase SDK which project to talk to.
 * The actual security boundary is (a) Firestore security rules
 * (README.md "Rules": every `users/{uid}` doc is only readable/writable by
 * that uid) and (b) the backend's `OWNER_UID` check in
 * `server/src/middleware/auth.ts`, which rejects any Firebase account but
 * yours.
 *
 * Get these values from the Firebase console: Project settings → General →
 * "Your apps" → (add a Web app if you haven't) → SDK setup and
 * configuration → Config.
 *
 * Not split per build configuration like environment.ts/environment.prod.ts
 * — a single-user personal instance has one Firebase project regardless of
 * dev vs. prod, so there's nothing to swap here.
 */
export const firebaseConfig = {
  apiKey: "AIzaSyCbUQZtL5BeP2n3n21zeN6L6YfL-SISgnM",
	authDomain: "my-streaming-969f8.firebaseapp.com",
	projectId: "my-streaming-969f8",
	storageBucket: "my-streaming-969f8.firebasestorage.app",
	messagingSenderId: "785338834560",
	appId: "1:785338834560:web:af26f2d631de72de469065"
};
