/**
 * Can this browser play our HEVC 10-bit encodes, and on the GPU?
 *
 * Chrome on Windows decodes HEVC through D3D11 (GPU only, nothing to install); Edge goes
 * through Media Foundation and needs Microsoft's "HEVC Video Extensions", and falls back to
 * software when the GPU can't do a profile. `MediaCapabilities.decodingInfo()` answers
 * supported / smooth / powerEfficient for a size + bitrate; powerEfficient is the browsers'
 * signal for hardware decoding.
 */

export type DecodeSupport = 'hardware' | 'software' | 'unsupported' | 'unknown';
/** `android` = the Android app (Media3 / MediaCodec, not the WebView). */
export type BrowserName = 'edge' | 'chrome' | 'firefox' | 'safari' | 'android' | 'other';

/** The video to check (an episode's `video` track, or a typical 1080p encode). */
export interface DecodeTarget {
  readonly codec: 'hevc' | 'h264';
  readonly bitDepth: 8 | 10;
  readonly width: number;
  readonly height: number;
  /** bits per second; 0 = unknown */
  readonly bitrate: number;
}

/** What the browser reported, before interpretation. */
export interface DecodeSignals {
  /** `video.canPlayType()` */
  readonly canPlay: '' | 'maybe' | 'probably';
  /** `decodingInfo()` result, null when the API isn't there or threw */
  readonly capabilities: { supported: boolean; smooth: boolean; powerEfficient: boolean } | null;
}

export interface DecodeReport {
  readonly support: DecodeSupport;
  readonly browser: BrowserName;
  readonly windows: boolean;
  /** "HEVC Main 10" */
  readonly label: string;
  /** what to do about it (null when hardware decoding works) */
  readonly advice: string | null;
}

/** Port: asks the browser (MediaCapabilities + canPlayType). */
export abstract class DecoderProbePort {
  abstract probe(target: DecodeTarget): Promise<DecodeReport>;
}

/** Typical encode from Step 1 (1080p, HEVC 10-bit, CQ 26 averages ~2–5 Mb/s, 8 Mb/s cap). */
export const TYPICAL_EPISODE: DecodeTarget = { codec: 'hevc', bitDepth: 10, width: 1920, height: 1080, bitrate: 5_000_000 };

/** RFC 6381 codec string. HEVC level from the height (L93 = 4.1-ish 720p, L120 = 1080p, L150 = 4K). */
export function codecString(codec: 'hevc' | 'h264', bitDepth: 8 | 10, height = 1080): string {
  if (codec === 'hevc') {
    const level = height <= 540 ? 90 : height <= 720 ? 93 : height <= 1080 ? 120 : 150;
    return bitDepth === 10 ? `video/mp4; codecs="hvc1.2.4.L${level}.B0"` : `video/mp4; codecs="hvc1.1.6.L${level}.B0"`;
  }
  return 'video/mp4; codecs="avc1.640028"';
}

export function codecLabel(t: Pick<DecodeTarget, 'codec' | 'bitDepth'>): string {
  if (t.codec === 'hevc') return t.bitDepth === 10 ? 'HEVC Main 10' : 'HEVC Main';
  return 'H.264';
}

/** Interpret what the browser said. */
export function decodeVerdict(s: DecodeSignals): DecodeSupport {
  if (s.capabilities) {
    if (!s.capabilities.supported) return 'unsupported';
    return s.capabilities.powerEfficient ? 'hardware' : 'software';
  }
  return s.canPlay === '' ? 'unsupported' : 'unknown';
}

/** Browser from User-Agent Client Hints brands (preferred) or the UA string. Edge before Chrome: Edge also says Chrome. */
export function browserFrom(brands: readonly string[], userAgent: string): BrowserName {
  if (brands.some((b) => /microsoft edge/i.test(b)) || /\bEdg(e|A|iOS)?\//.test(userAgent)) return 'edge';
  if (/firefox\//i.test(userAgent)) return 'firefox';
  if (brands.some((b) => /google chrome|chromium/i.test(b)) || /\b(Chrome|CriOS)\//.test(userAgent)) return 'chrome';
  if (/safari\//i.test(userAgent)) return 'safari';
  return 'other';
}

export const BROWSER_NAME: Record<BrowserName, string> = {
  edge: 'Edge',
  chrome: 'Chrome',
  firefox: 'Firefox',
  safari: 'Safari',
  android: 'This phone',
  other: 'This browser',
};

/** What to tell the user. Null when there's nothing to fix. */
export function decodeAdvice(support: DecodeSupport, browser: BrowserName, windows: boolean, label = 'HEVC Main 10'): string | null {
  if (support === 'hardware') return null;
  if (support === 'unknown') {
    return `${BROWSER_NAME[browser]} didn't say whether it decodes ${label} on the GPU. Playback will be tried anyway.`;
  }
  if (browser === 'android') {
    return support === 'software'
      ? `This phone has no hardware decoder for ${label}, so the software one is used: it may stutter and drain the battery.`
      : `This phone has no decoder for ${label}. Watch it on the PC, or re-import the series for older phones.`;
  }
  if (browser === 'edge' && windows) {
    return support === 'software'
      ? `Edge is decoding ${label} in software (the GPU path isn't available), so it may stutter. Check edge://gpu → "Decode hevc main 10", update the GPU driver, or use Chrome.`
      : `Edge needs Microsoft's "HEVC Video Extensions" (Microsoft Store) to play ${label}. Install it and restart Edge, check that hardware acceleration is on (edge://settings/system), or use Chrome.`;
  }
  if (browser === 'chrome' && windows) {
    return support === 'software'
      ? `Chrome reports ${label} without GPU decoding, so it may stutter. Check chrome://gpu → "Decode hevc main 10" and update the GPU driver.`
      : `Chrome plays ${label} only with GPU decoding. Turn on "Use graphics acceleration when available" (chrome://settings/system), update the GPU driver, and check chrome://gpu → "Decode hevc main 10".`;
  }
  return support === 'software'
    ? `${BROWSER_NAME[browser]} decodes ${label} in software here, so it may stutter. Chrome or Edge on Windows, or the Android app, use the GPU.`
    : `${BROWSER_NAME[browser]} can't decode ${label} here. Use Chrome or Edge on Windows, or the Android app.`;
}
