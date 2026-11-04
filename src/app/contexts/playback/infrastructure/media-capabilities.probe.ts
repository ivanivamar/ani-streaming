import { DOCUMENT, inject, Injectable } from '@angular/core';
import {
  browserFrom,
  codecLabel,
  codecString,
  decodeAdvice,
  decodeVerdict,
  DecoderProbePort,
  type DecodeReport,
  type DecodeSignals,
  type DecodeTarget,
} from '../domain';

interface UaData {
  brands?: { brand: string }[];
  platform?: string;
}

/**
 * Asks the browser: `MediaCapabilities.decodingInfo({ type: 'file' })` for the episode's size and
 * bitrate (supported / powerEfficient = GPU), plus `canPlayType` as a fallback. Results are
 * cached per codec string + size for the page's lifetime (the answer doesn't change while it runs).
 */
@Injectable()
export class MediaCapabilitiesProbe extends DecoderProbePort {
  private readonly doc = inject(DOCUMENT);
  private readonly cache = new Map<string, Promise<DecodeReport>>();

  probe(target: DecodeTarget): Promise<DecodeReport> {
    const type = codecString(target.codec, target.bitDepth, target.height);
    const key = `${type}|${target.width}x${target.height}`;
    let p = this.cache.get(key);
    if (!p) {
      p = this.run(target, type);
      this.cache.set(key, p);
    }
    return p;
  }

  private async run(target: DecodeTarget, contentType: string): Promise<DecodeReport> {
    const nav = this.doc.defaultView?.navigator;
    const ua = (nav as (Navigator & { userAgentData?: UaData }) | undefined)?.userAgentData;
    const userAgent = nav?.userAgent ?? '';
    const browser = browserFrom(ua?.brands?.map((b) => b.brand) ?? [], userAgent);
    const windows = /windows/i.test(ua?.platform ?? '') || /Windows NT/.test(userAgent);

    const video = this.doc.createElement('video');
    const canPlay = (video.canPlayType?.(contentType) ?? '') as DecodeSignals['canPlay'];
    let capabilities: DecodeSignals['capabilities'] = null;
    if (nav?.mediaCapabilities?.decodingInfo) {
      try {
        const info = await nav.mediaCapabilities.decodingInfo({
          type: 'file',
          video: {
            contentType,
            width: target.width,
            height: target.height,
            bitrate: target.bitrate > 0 ? target.bitrate : 5_000_000,
            framerate: 24000 / 1001,
          },
        });
        capabilities = { supported: info.supported, smooth: info.smooth, powerEfficient: info.powerEfficient };
      } catch (e) {
        console.warn('[decode] decodingInfo failed', e);
      }
    }
    const support = decodeVerdict({ canPlay, capabilities });
    const label = codecLabel(target);
    return { support, browser, windows, label, advice: decodeAdvice(support, browser, windows, label) };
  }
}
