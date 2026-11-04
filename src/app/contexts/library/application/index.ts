/**
 * library / application — public API of the library context.
 *
 * Other contexts and the shell may import only from this file, never from another
 * context's domain/, infrastructure/ or ui/.
 */
export { LibraryStore } from './library.store';
export { ProgressTracker } from './progress-tracker';
export {
  fraction,
  isWatched,
  LIBRARY_STATUSES,
  nextEpisode,
  parseProgressId,
  resumeTarget,
  STATUS_LABEL,
  UserDataRepository,
  type EpisodeLike,
  type Favourite,
  type LibraryEntry,
  type LibraryStatus,
  type RecentSearch,
  type ResumeTarget,
  type UserData,
  type WatchProgress,
} from '../domain';
