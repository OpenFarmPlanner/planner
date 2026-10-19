import { describe, expect, it } from 'vitest';
import { EMAIL_PATTERN, memberInitials } from '../pages/projectSettingsMembers';

describe('memberInitials', () => {
  it.each([
    ['Member Name', 'MN'],
    ['anna', 'AN'],
    ['martin.stipsitz@gmail.com', 'MS'],
    ['Jean-Luc Picard', 'JL'],
    ['', '?'],
  ])('turns %j into %j', (name, initials) => {
    expect(memberInitials(name)).toBe(initials);
  });
});

describe('EMAIL_PATTERN', () => {
  it.each(['a@b.de', 'first.last+tag@example.org'])('accepts %s', (email) => {
    expect(EMAIL_PATTERN.test(email)).toBe(true);
  });

  it.each(['plain', 'a@b', 'a b@c.de', '@example.org'])('rejects %s', (email) => {
    expect(EMAIL_PATTERN.test(email)).toBe(false);
  });
});
