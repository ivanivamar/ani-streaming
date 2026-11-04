import type { Favourite, LibraryEntry, RecentSearch, UserData, WatchProgress } from './models';

/** Port: everything under `users/{uid}` this context owns. Implemented with Firestore. */
export abstract class UserDataRepository {
  abstract load(uid: string): Promise<UserData>;
  abstract saveProgress(uid: string, p: WatchProgress): Promise<void>;
  abstract deleteProgress(uid: string, ids: readonly { seriesId: string; episodeId: string }[]): Promise<void>;
  abstract saveEntry(uid: string, e: LibraryEntry): Promise<void>;
  abstract deleteEntry(uid: string, seriesId: string): Promise<void>;
  abstract addFavourite(uid: string, f: Favourite): Promise<void>;
  abstract removeFavourite(uid: string, seriesId: string): Promise<void>;
  abstract saveRecent(uid: string, r: RecentSearch): Promise<void>;
  abstract deleteRecent(uid: string, ids: readonly string[]): Promise<void>;
}
