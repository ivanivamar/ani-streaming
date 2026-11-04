/**
 * playback / application — public API of the playback context.
 *
 * Other contexts and the shell may import only from this file, never from another
 * context's domain/, infrastructure/ or ui/.
 */
export { PlaybackStore, type PlayableEpisode } from './playback.store';
export {
  CAPTION_LABEL,
  captionModes,
  captionTrack,
  codecString,
  initialCaption,
  skippableChapter,
  VideoSourcePort,
  type CaptionMode,
  type DriveVideo,
} from '../domain';
