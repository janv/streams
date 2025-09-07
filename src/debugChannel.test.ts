import { makeValueChannel } from './Channel.js';
import debugChannel from './debugChannel.js';

describe('debugChannel', () => {
  beforeEach(() => {
    // @ts-ignore
    global.crypto = { randomUUID: () => '' };
  });
  test('returns identical channels for identical inputs', () => {
    const channel = makeValueChannel(() => 'hallo');
    const a1 = debugChannel(channel, 'first');
    const a2 = debugChannel(channel, 'first');

    const b = debugChannel(channel, 'second');

    expect(a1).toBe(a2);
    expect(a1).not.toBe(b);
  });
});
