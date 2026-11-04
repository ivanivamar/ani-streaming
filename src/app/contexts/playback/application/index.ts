/**
 * playback / application — public API of the playback context.
 *
 * Other contexts and the shell may import only from this file, never from another
 * context's domain/, infrastructure/ or ui/.
 */
export { PlaybackStore, type PlayableEpisode } from './playback.store';
export {
  BROWSER_NAME,
  CAPTION_LABEL,
  captionModes,
  captionTrack,
  chapterSkips,
  initialCaption,
  skippableChapter,
  DecoderProbePort,
  SkipTimesPort,
  SubtitleRendererPort,
  TYPICAL_EPISODE,
  VideoSourcePort,
  type CaptionMode,
  type DecodeReport,
  type DecodeSupport,
  type DriveVideo,
  type SkipSegment,
  type SubtitleFile,
  type SubtitleSession,
} from '../domain';
