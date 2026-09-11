import { initializeApp } from 'firebase/app';
import { getAuth } from 'firebase/auth';
import { firebaseConfig } from '../../environments/firebase-config';

/**
 * Plain Firebase JS SDK singletons, initialized once at module load.
 *
 * Deliberately not AngularFire: at the time this was written, @angular/fire
 * (latest published: v20) peer-depends on `@angular/core@^20`, which
 * conflicts with this project's Angular 22 and would fail `npm install`
 * under npm's default peer-dependency resolution — the same class of
 * problem as swagger-ui-express vs. Express 5 on the backend. The modular
 * `firebase` package has no Angular peer dependency at all, so it isn't
 * exposed to that. Revisit AngularFire once its peer range catches up.
 */
export const firebaseApp = initializeApp(firebaseConfig);
export const auth = getAuth(firebaseApp);
