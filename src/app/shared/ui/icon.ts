import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';

/** circle as a path, so every icon is a list of `d` strings */
const c = (cx: number, cy: number, r: number) => `M${cx - r} ${cy}a${r} ${r} 0 1 0 ${r * 2} 0a${r} ${r} 0 1 0 ${-r * 2} 0`;

interface IconDef {
  readonly d: readonly string[];
  /** filled glyph (play, pause, dots) instead of a rounded stroke */
  readonly fill?: boolean;
  readonly viewBox?: string;
}

/**
 * The v3 icon set (paths copied from the prototype). All stroked icons are rounded
 * (`stroke-linecap/linejoin="round"`); filled glyphs use rounded shapes.
 */
export const ICONS = {
  home: { d: ['M3.5 10.2 12 3.6l8.5 6.6v8.3a1.5 1.5 0 0 1-1.5 1.5h-4v-6H9v6H5a1.5 1.5 0 0 1-1.5-1.5z'] },
  library: { d: ['M5.5 4v16M10 4v16M14 4.6l4.8 15'] },
  releases: {
    d: ['M6.5 5h11A2.5 2.5 0 0 1 20 7.5v10a2.5 2.5 0 0 1-2.5 2.5h-11A2.5 2.5 0 0 1 4 17.5v-10A2.5 2.5 0 0 1 6.5 5zM4 10h16M8.5 3v4M15.5 3v4'],
  },
  download: { d: ['M12 4v11M7.5 10.5 12 15l4.5-4.5M5 20h14'] },
  import: { d: ['M13.5 3h-6A2.5 2.5 0 0 0 5 5.5v13A2.5 2.5 0 0 0 7.5 21h9a2.5 2.5 0 0 0 2.5-2.5V8.5zM13.5 3v3.5a2 2 0 0 0 2 2H19M12 11.5v6M9 14.5h6'] },
  film: { d: ['M5.5 5h13A2.5 2.5 0 0 1 21 7.5v9a2.5 2.5 0 0 1-2.5 2.5h-13A2.5 2.5 0 0 1 3 16.5v-9A2.5 2.5 0 0 1 5.5 5z', 'M10 9.5v5l4.2-2.5z'] },
  refresh: { d: ['M20 12a8 8 0 1 1-2.3-5.6M20 4v4h-4'] },
  copy: { d: ['M9 9h9.5A1.5 1.5 0 0 1 20 10.5V19a1.5 1.5 0 0 1-1.5 1.5H10A1.5 1.5 0 0 1 8.5 19v-8.5A1.5 1.5 0 0 1 9 9zM15.5 9V5.5A1.5 1.5 0 0 0 14 4H5.5A1.5 1.5 0 0 0 4 5.5V14a1.5 1.5 0 0 0 1.5 1.5H8.5'] },
  settings: {
    d: [
      c(12, 12, 3),
      'M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z',
    ],
  },
  logout: { d: ['M14 4h5v16h-5M10 8l-4 4 4 4M6 12h10'] },
  panel: { d: ['M6 4.5h12a2.5 2.5 0 0 1 2.5 2.5v10a2.5 2.5 0 0 1-2.5 2.5H6A2.5 2.5 0 0 1 3.5 17V7A2.5 2.5 0 0 1 6 4.5zM9.5 4.5v15'] },
  updown: { d: ['M8 9.5l4-4 4 4M8 14.5l4 4 4-4'] },
  search: { d: [c(10.5, 10.5, 6.5), 'M15.5 15.5 20 20'] },
  clock: { d: [c(12, 12, 8), 'M12 8v4l2.5 2'] },
  close: { d: ['M6 6l12 12M18 6 6 18'] },
  'chevron-down': { d: ['M6 9l6 6 6-6'] },
  'chevron-left': { d: ['M15 6l-6 6 6 6'] },
  'chevron-right': { d: ['M9 6l6 6-6 6'] },
  back: { d: ['M15 5l-7 7 7 7'] },
  more: { d: [c(5.5, 12, 1.7), c(12, 12, 1.7), c(18.5, 12, 1.7)], fill: true },
  heart: { d: ['M12 20.5 3.8 12.3a5 5 0 0 1 7.1-7.1l1.1 1.1 1.1-1.1a5 5 0 1 1 7.1 7.1Z'] },
  play: { d: ['M8 5.2v13.6a1 1 0 0 0 1.5.86l11-6.8a1 1 0 0 0 0-1.72l-11-6.8A1 1 0 0 0 8 5.2z'] },
  'play-fill': { d: ['M7 4.7v14.6a1.2 1.2 0 0 0 1.8 1l11.6-7.3a1.2 1.2 0 0 0 0-2L8.8 3.7A1.2 1.2 0 0 0 7 4.7z'], fill: true },
  'pause-fill': {
    d: ['M7.1 4h1.3A1.6 1.6 0 0 1 10 5.6v12.8A1.6 1.6 0 0 1 8.4 20H7.1a1.6 1.6 0 0 1-1.6-1.6V5.6A1.6 1.6 0 0 1 7.1 4zM15.6 4h1.3a1.6 1.6 0 0 1 1.6 1.6v12.8a1.6 1.6 0 0 1-1.6 1.6h-1.3a1.6 1.6 0 0 1-1.6-1.6V5.6A1.6 1.6 0 0 1 15.6 4z'],
    fill: true,
  },
  restart: { d: ['M4 12a8 8 0 1 0 2.3-5.6M4 4v4h4'] },
  go: { d: ['M5 12h14M13 6l6 6-6 6'] },
  check: { d: ['M5 12.5l4.5 4.5L19 7.5'] },
  remove: {
    d: ['M4.5 7h15M9.5 7V5a1 1 0 0 1 1-1h3a1 1 0 0 1 1 1v2M6.5 7l.9 12a1.5 1.5 0 0 0 1.5 1.4h6.2a1.5 1.5 0 0 0 1.5-1.4l.9-12'],
  },
  grid: {
    d: [
      'M5.5 4h3.5A1.5 1.5 0 0 1 10.5 5.5V9A1.5 1.5 0 0 1 9 10.5H5.5A1.5 1.5 0 0 1 4 9V5.5A1.5 1.5 0 0 1 5.5 4z',
      'M15 4h3.5A1.5 1.5 0 0 1 20 5.5V9a1.5 1.5 0 0 1-1.5 1.5H15A1.5 1.5 0 0 1 13.5 9V5.5A1.5 1.5 0 0 1 15 4z',
      'M5.5 13.5h3.5a1.5 1.5 0 0 1 1.5 1.5v3.5A1.5 1.5 0 0 1 9 20H5.5A1.5 1.5 0 0 1 4 18.5V15a1.5 1.5 0 0 1 1.5-1.5z',
      'M15 13.5h3.5A1.5 1.5 0 0 1 20 15v3.5a1.5 1.5 0 0 1-1.5 1.5H15a1.5 1.5 0 0 1-1.5-1.5V15a1.5 1.5 0 0 1 1.5-1.5z',
    ],
  },
  list: { d: ['M9 6h11M9 12h11M9 18h11', c(4.5, 6, 1), c(4.5, 12, 1), c(4.5, 18, 1)] },
  sort: { d: ['M7 4v16M3.5 16.5 7 20l3.5-3.5M14 6h7M14 12h5M14 18h3'] },
  bell: { d: ['M6 9.5a6 6 0 0 1 12 0c0 5 2 6.5 2 6.5H4s2-1.5 2-6.5zM10 19.5a2 2 0 0 0 4 0'] },
  status: { d: [c(12, 12, 8), 'M12 8v4h3'] },
  next: {
    d: ['M4 4.4v11.2a1 1 0 0 0 1.55.83l8.2-5.6a1 1 0 0 0 0-1.66l-8.2-5.6A1 1 0 0 0 4 4.4zM16.4 3.5a1.2 1.2 0 0 1 1.2 1.2v10.6a1.2 1.2 0 0 1-2.4 0V4.7a1.2 1.2 0 0 1 1.2-1.2z'],
    fill: true,
    viewBox: '0 0 20 20',
  },
  episodes: {
    d: [
      'M3 4h10a1 1 0 0 1 0 2H3a1 1 0 0 1 0-2zM3 9h10a1 1 0 0 1 0 2H3a1 1 0 0 1 0-2zM3 14h6a1 1 0 0 1 0 2H3a1 1 0 0 1 0-2z',
      'M14.5 13.9v3.4a.6.6 0 0 0 .9.5l2.8-1.7a.6.6 0 0 0 0-1l-2.8-1.7a.6.6 0 0 0-.9.5z',
    ],
    fill: true,
    viewBox: '0 0 20 20',
  },
  fullscreen: {
    d: ['M2.5 7V4.5a2 2 0 0 1 2-2H7M17.5 13v2.5a2 2 0 0 1-2 2H13M13 2.5h2.5a2 2 0 0 1 2 2V7M7 17.5H4.5a2 2 0 0 1-2-2V13'],
    viewBox: '0 0 20 20',
  },
  'fullscreen-exit': {
    d: ['M7.5 2.5v3a2 2 0 0 1-2 2h-3M12.5 17.5v-3a2 2 0 0 1 2-2h3M17.5 7.5h-3a2 2 0 0 1-2-2v-3M2.5 12.5h3a2 2 0 0 1 2 2v3'],
    viewBox: '0 0 20 20',
  },
  cc: {
    d: ['M6 5h12a3 3 0 0 1 3 3v8a3 3 0 0 1-3 3H6a3 3 0 0 1-3-3V8a3 3 0 0 1 3-3z', 'M10.5 10.2a2.2 2.2 0 1 0 0 3.6M17 10.2a2.2 2.2 0 1 0 0 3.6'],
  },
  skip: { d: ['M5 5.5v13l8.5-6.5zM13.5 5.5v13l6-6.5z'] },
  user: { d: [c(12, 8.5, 3.8), 'M4.5 20a7.5 7.5 0 0 1 15 0'] },
  export: { d: ['M12 15V4M7.5 8.5 12 4l4.5 4.5M5 14v4.5A1.5 1.5 0 0 0 6.5 20h11a1.5 1.5 0 0 0 1.5-1.5V14'] },
} satisfies Record<string, IconDef>;

export type IconName = keyof typeof ICONS;

/** `<app-icon name="home" [size]="18" />` — inherits `currentColor`. */
@Component({
  selector: 'app-icon',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { 'aria-hidden': 'true', '[style.width.px]': 'size()', '[style.height.px]': 'size()' },
  template: `
    <svg
      [attr.viewBox]="def().viewBox ?? '0 0 24 24'"
      [attr.fill]="def().fill || filled() ? 'currentColor' : 'none'"
      [attr.stroke]="def().fill ? 'none' : 'currentColor'"
      [attr.stroke-width]="stroke()"
      stroke-linecap="round"
      stroke-linejoin="round"
    >
      @for (d of def().d; track $index) {
        <path [attr.d]="d" />
      }
    </svg>
  `,
  styles: `
    :host {
      display: inline-flex;
      flex: none;
    }
    svg {
      width: 100%;
      height: 100%;
    }
  `,
})
export class Icon {
  readonly name = input.required<IconName>();
  readonly size = input(18);
  readonly stroke = input(1.7);
  /** fill a stroked shape too (favourite heart, active bell) */
  readonly filled = input(false);

  protected readonly def = computed<IconDef>(() => ICONS[this.name()]);
}
