/**
 * Lets Node's type stripping load `@ani/contracts`, whose relative imports have no extension
 * (the Angular build wants them that way). Tries `<specifier>.ts` when a relative import
 * without an extension fails. Registered by `cli.ts` before anything imports the contracts.
 */
import { registerHooks } from 'node:module';

registerHooks({
  resolve(specifier, context, nextResolve) {
    try {
      return nextResolve(specifier, context);
    } catch (e) {
      if (/^\.\.?\//.test(specifier) && !/\.[cm]?[jt]s$/.test(specifier)) {
        return nextResolve(`${specifier}.ts`, context);
      }
      throw e;
    }
  },
});
