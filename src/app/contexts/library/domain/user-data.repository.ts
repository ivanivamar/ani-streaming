import type { Favourite, LibraryEntry, RecentSearch, UserData, WatchProgress } from './models';

/** Port: everything under `users/{uid}` this context owns. Implemented with Firestore. */
export abstract class UserDataRepository {
  /** Everything this context owns, read from the server when online (export uses it too). */
  abstract load(uid: string): Promise<UserData>;
  abstract saveProgress(uid: string, p: WatchProgress): Promise<void>;
  abstract deleteProgress(uid: string, ids: readonly { seriesId: string; episodeId: string }[]): Promise<void>;
  abstract saveEntry(uid: string, e: LibraryEntry): Promise<void>;
  abstract deleteEntry(uid: string, seriesId: string): Promise<void>;
  abstract addFavourite(uid: string, f: Favourite): Promise<void>;
  abstract removeFavourite(uid: string, seriesId: string): Promise<void>;
  abstract saveRecent(uid: string, r: RecentSearch): Promise<void>;
  abstract deleteRecent(uid: string, ids: readonly string[]): Promise<void>;
  /**
   * Settings → Clear watch history: deletes every `progress` doc (queried, not just the ones in
   * memory) and sets `watched` to 0 on every library entry; statuses and favourites stay.
   * Resolves with the number of progress docs removed.
   */
  abstract clearHistory(uid: string): Promise<number>;
}
