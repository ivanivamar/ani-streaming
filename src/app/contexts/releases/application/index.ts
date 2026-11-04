/**
 * releases / application — public API of the releases context.
 *
 * Other contexts and the shell may import only from this file, never from another
 * context's domain/, infrastructure/ or ui/.
 */
export {
  ReleasesStore,
  type AiringItem,
  type AiringState,
  type DayColumn,
  type LibraryMatch,
  type PremiereItem,
  type ReleaseScope,
  type WeekView,
} from './releases.store';
export { airingKey, NotifyRepository, premiereKey, SchedulePort, type Airing, type NotifyEntry, type Premiere } from '../domain';
