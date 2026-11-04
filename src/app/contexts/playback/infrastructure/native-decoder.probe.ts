import { Injectable } from '@angular/core';
import { AniPlayer } from '@shared/infrastructure';
import { codecLabel, decodeAdvice, DecoderProbePort, type DecodeReport, type DecodeSupport, type DecodeTarget } from '../domain';

/**
 * Android app: what MediaCodec offers for the episode (ExoPlayer decodes, not the WebView):
 * a hardware decoder → `hardware`, only a software one → `software`, none → `unsupported`.
 */
@Injectable()
export class NativeDecoderProbe extends DecoderProbePort {
  private readonly cache = new Map<string, Promise<DecodeReport>>();

  probe(target: DecodeTarget): Promise<DecodeReport> {
    const key = `${target.codec}|${target.bitDepth}|${target.width}x${target.height}`;
    let p = this.cache.get(key);
    if (!p) {
      p = this.run(target);
      this.cache.set(key, p);
    }
    return p;
  }

  private async run(target: DecodeTarget): Promise<DecodeReport> {
    let support: DecodeSupport = 'unknown';
    try {
      const info = await AniPlayer.decoderInfo({ codec: target.codec, bitDepth: target.bitDepth, width: target.width, height: target.height });
      support = !info.supported ? 'unsupported' : info.hardware ? 'hardware' : 'software';
    } catch (e) {
      console.warn('[decode] decoderInfo failed', e);
    }
    const label = codecLabel(target);
    return { support, browser: 'android', windows: false, label, advice: decodeAdvice(support, 'android', false, label) };
  }
}
