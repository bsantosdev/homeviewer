import { isNight } from './night';

function at(hours: number, minutes = 0): Date {
  return new Date(2026, 9, 26, hours, minutes);
}

describe('isNight', () => {
  const overnight = { nightMode: true, nightStart: '22:00', nightEnd: '07:00' };

  it('runs past midnight, from the start up to but not including the end', () => {
    expect(isNight(overnight, at(21, 59))).toBe(false);
    expect(isNight(overnight, at(22))).toBe(true);
    expect(isNight(overnight, at(3))).toBe(true);
    expect(isNight(overnight, at(6, 59))).toBe(true);
    expect(isNight(overnight, at(7))).toBe(false);
    expect(isNight(overnight, at(12))).toBe(false);
  });

  it('works within one day', () => {
    const early = { nightMode: true, nightStart: '01:00', nightEnd: '06:30' };
    expect(isNight(early, at(0, 59))).toBe(false);
    expect(isNight(early, at(1))).toBe(true);
    expect(isNight(early, at(6, 29))).toBe(true);
    expect(isNight(early, at(6, 30))).toBe(false);
    expect(isNight(early, at(23))).toBe(false);
  });

  it('is never night while switched off, with equal times, or with times it can’t read', () => {
    expect(isNight({ ...overnight, nightMode: false }, at(23))).toBe(false);
    expect(isNight({ ...overnight, nightEnd: '22:00' }, at(23))).toBe(false);
    expect(isNight({ ...overnight, nightStart: '' }, at(23))).toBe(false);
    expect(isNight({ ...overnight, nightEnd: '7am' }, at(23))).toBe(false);
  });
});
