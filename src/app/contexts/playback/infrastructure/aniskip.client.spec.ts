import { AniSkipClient } from './aniskip.client';

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

describe('AniSkipClient', () => {
  let calls: string[];
  beforeEach(() => {
    calls = [];
    localStorage.clear();
  });
  afterEach(() => vi.unstubAllGlobals());

  it('maps the AniList id to MAL, asks AniSkip with the episode length and parses the results', async () => {
    vi.stubGlobal('fetch', async (url: string) => {
      calls.push(url);
      if (url.includes('anilist')) return json({ data: { Media: { idMal: 49784 } } });
      return json({
        found: true,
        results: [
          { interval: { startTime: 1356.4, endTime: 1444.2 }, skipType: 'ed', skipId: 'x', episodeLength: 1475.1 },
          { interval: { startTime: 0, endTime: 5 }, skipType: 'recap', skipId: 'y', episodeLength: 1475.1 },
        ],
        message: 'Successfully found skip times',
        statusCode: 200,
      });
    });
    const client = new AniSkipClient();
    const got = await client.find({ anilistId: 134732, episode: 1, durationSec: 1474 });
    expect(got).toEqual([{ kind: 'ed', startSec: 1356.4, endSec: 1444.2, episodeLengthSec: 1475.1 }]);
    expect(calls[1]).toContain('/skip-times/49784/1?');
    expect(decodeURIComponent(calls[1])).toContain('types[]=op&types[]=ed&types[]=mixed-op&types[]=mixed-ed&episodeLength=1474');
    // cached for the session, MAL id remembered across sessions
    await client.find({ anilistId: 134732, episode: 1, durationSec: 1474 });
    expect(calls).toHaveLength(2);
    expect(JSON.parse(localStorage.getItem('ani.malIds.v1')!)).toEqual({ 134732: 49784 });
  });

  it('treats a 404 or a missing MAL id as "no times"', async () => {
    vi.stubGlobal('fetch', async (url: string) =>
      url.includes('anilist') ? json({ data: { Media: { idMal: 1 } } }) : json({ found: false, results: [], statusCode: 404 }, 404),
    );
    expect(await new AniSkipClient().find({ anilistId: 1, episode: 3, durationSec: 1420 })).toEqual([]);
    vi.stubGlobal('fetch', async () => json({ data: { Media: { idMal: null } } }));
    expect(await new AniSkipClient().find({ anilistId: 2, episode: 1, durationSec: 1420 })).toEqual([]);
  });

  it('rejects on a server error and retries next time', async () => {
    let fail = true;
    vi.stubGlobal('fetch', async (url: string) => {
      if (url.includes('anilist')) return json({ data: { Media: { idMal: 5 } } });
      return fail ? json({}, 500) : json({ found: true, results: [] });
    });
    const client = new AniSkipClient();
    await expect(client.find({ anilistId: 9, episode: 1, durationSec: 1400 })).rejects.toThrow('AniSkip 500');
    fail = false;
    expect(await client.find({ anilistId: 9, episode: 1, durationSec: 1400 })).toEqual([]);
  });
});
