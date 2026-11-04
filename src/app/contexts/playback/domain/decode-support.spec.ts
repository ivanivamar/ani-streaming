import { browserFrom, codecString, decodeAdvice, decodeVerdict } from './decode-support';

const EDGE_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Safari/537.36 Edg/142.0.0.0';
const CHROME_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Safari/537.36';

describe('decode support', () => {
  it('builds HEVC Main 10 codec strings with a level for the height', () => {
    expect(codecString('hevc', 10)).toBe('video/mp4; codecs="hvc1.2.4.L120.B0"');
    expect(codecString('hevc', 10, 720)).toBe('video/mp4; codecs="hvc1.2.4.L93.B0"');
    expect(codecString('hevc', 8, 2160)).toBe('video/mp4; codecs="hvc1.1.6.L150.B0"');
    expect(codecString('h264', 8)).toContain('avc1');
  });

  it('reads powerEfficient as GPU decoding', () => {
    expect(decodeVerdict({ canPlay: 'probably', capabilities: { supported: true, smooth: true, powerEfficient: true } })).toBe('hardware');
    expect(decodeVerdict({ canPlay: 'probably', capabilities: { supported: true, smooth: false, powerEfficient: false } })).toBe('software');
    expect(decodeVerdict({ canPlay: 'probably', capabilities: { supported: false, smooth: false, powerEfficient: false } })).toBe('unsupported');
    expect(decodeVerdict({ canPlay: '', capabilities: null })).toBe('unsupported');
    expect(decodeVerdict({ canPlay: 'maybe', capabilities: null })).toBe('unknown');
  });

  it('tells Edge from Chrome (Edge also says Chrome)', () => {
    expect(browserFrom(['Chromium', 'Microsoft Edge', 'Not_A Brand'], EDGE_UA)).toBe('edge');
    expect(browserFrom([], EDGE_UA)).toBe('edge');
    expect(browserFrom(['Chromium', 'Google Chrome'], CHROME_UA)).toBe('chrome');
    expect(browserFrom([], 'Mozilla/5.0 (Windows NT 10.0; rv:140.0) Gecko/20100101 Firefox/140.0')).toBe('firefox');
  });

  it('gives browser-specific advice', () => {
    expect(decodeAdvice('hardware', 'edge', true)).toBeNull();
    expect(decodeAdvice('unsupported', 'edge', true)).toContain('HEVC Video Extensions');
    expect(decodeAdvice('software', 'edge', true)).toContain('edge://gpu');
    expect(decodeAdvice('unsupported', 'chrome', true)).toContain('chrome://settings/system');
    expect(decodeAdvice('unsupported', 'firefox', false)).toContain('Android app');
  });
});
