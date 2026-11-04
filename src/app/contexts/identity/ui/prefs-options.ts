import type { SubtitleMode } from '@identity/application';
import type { SegmentOption } from '@shared/ui';

export const SUBTITLE_OPTIONS: readonly SegmentOption<SubtitleMode>[] = [
  { value: 'full', label: 'Full' },
  { value: 'signs', label: 'Signs only' },
  { value: 'off', label: 'Off' },
];
