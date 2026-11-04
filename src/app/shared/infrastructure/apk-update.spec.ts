import { newerRelease } from './apk-update';

const rel = (tag: string, apk = true, extra: Partial<{ draft: boolean; prerelease: boolean }> = {}) => ({
  tag_name: tag,
  name: tag.replace('android-', '1.0.'),
  draft: false,
  prerelease: false,
  assets: apk ? [{ name: 'ani-stream.apk', browser_download_url: `https://example/${tag}.apk` }] : [],
  ...extra,
});

describe('newerRelease', () => {
  it('picks the highest android-<n> release with an APK above the installed version', () => {
    const r = newerRelease([rel('android-12'), rel('android-14'), rel('android-15', false), rel('v2'), rel('android-16', true, { draft: true })], 12);
    expect(r).toEqual({ versionCode: 14, versionName: '1.0.14', url: 'https://example/android-14.apk' });
  });

  it('is null when nothing is newer', () => {
    expect(newerRelease([rel('android-12')], 12)).toBeNull();
    expect(newerRelease([], 1)).toBeNull();
  });
});
