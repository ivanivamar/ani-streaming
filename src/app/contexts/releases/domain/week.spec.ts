import { weekDays, weekRange, weekTitle } from './week';

describe('release weeks', () => {
  it('starts weeks on Monday and pages by 7 days', () => {
    const wed = new Date(2026, 10, 4, 15).getTime(); // Wed 4 Nov 2026
    const w = weekRange(0, wed);
    expect(new Date(w.start).getDay()).toBe(1);
    expect(new Date(w.start).getDate()).toBe(2);
    expect(weekDays(w)).toHaveLength(7);
    expect(new Date(weekRange(1, wed).start).getDate()).toBe(9);
    expect(new Date(weekRange(-1, wed).start).getDate()).toBe(26);
  });

  it('names weeks', () => {
    expect([0, -1, 1, 3, -2].map(weekTitle)).toEqual(['This week', 'Last week', 'Next week', 'In 3 weeks', '2 weeks ago']);
  });
});

describe('popular only', () => {
  it('keeps the most popular shows (all their episodes) plus kept ones', async () => {
    const { popularOnly } = await import('./models');
    const a = (anilistId: number, popularity: number) => ({ anilistId, popularity });
    const items = [a(1, 900), a(1, 900), a(2, 50), a(3, 500), a(4, 10)];
    const { shown, hiddenShows } = popularOnly(items, 2, (i) => i.anilistId === 4);
    expect(shown.map((i) => i.anilistId)).toEqual([1, 1, 3, 4]);
    expect(hiddenShows).toBe(1);
  });
});
