/**
 * shared / ui — the v3 design system. Presentational only: no application or infrastructure
 * imports. Global tokens and utility classes are in `design-system.css` (loaded by styles.css).
 */
export { Icon, ICONS, type IconName } from './icon';
export { Pill, Segmented, Toggle, type SegmentOption } from './controls';
export { Dropdown, type DropdownOption } from './dropdown';
export { ContextMenu, ContextMenuHost, type MenuItem } from './context-menu';
export { Poster, hueOf, posterBackground, posterGradient, thumbGradient } from './poster';
export { PosterCard } from './poster-card';
export { Avatar, GoogleG, Logo, initials } from './brand';
export { Motion, Stagger } from './motion';
export { Viewport } from './viewport';
