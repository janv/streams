/* eslint-disable @typescript-eslint/no-unused-vars */

import { makeSource } from './index.js';
import { makeValueChannel, syncBuffer, type ReadWriteChannel } from './Channel.js';

function makeBufferedChannel(
  go?: (emit: (...args: number[]) => void) => void,
  value?: () => number
) {
  const stream = makeSource<number>(go);
  const update = jest.fn();
  const channel: ReadWriteChannel<number> = {
    subscribe: stream,
    update,
    value
  };

  const {
    subscribe: bufferedSource,
    update: bufferedUpdate,
    value: bufferedValue
  } = syncBuffer(channel);

  return {
    stream,
    update,
    bufferedSource,
    bufferedUpdate,
    value: bufferedValue
  };
}

function makeNonDuplicatingChannel(value?: () => number) {
  const stream = makeSource<number>();
  const update = jest.fn();
  const channel: ReadWriteChannel<number> = {
    subscribe: stream,
    update,
    value
  };

  const {
    subscribe: bufferedSource,
    update: bufferedUpdate,
    value: bufferedValue
  } = syncBuffer(channel, (a, b) => a === b);

  return {
    stream,
    update,
    bufferedSource,
    bufferedUpdate,
    value: bufferedValue
  };
}

describe('syncBuffer', () => {
  test('invokes consumer immediately with sync value from channel', () => {
    const { bufferedSource } = makeBufferedChannel((e) => e(123));

    const handler = jest.fn();
    bufferedSource(handler);
    expect(handler).toHaveBeenCalledWith(123);
  });

  test('when updating, synchronously calls consumer with synchronous answer from source', () => {
    const { bufferedSource, update, bufferedUpdate, stream } =
      makeBufferedChannel();
    update.mockImplementation((v) => stream.emit(v * 2));

    const handler = jest.fn();
    bufferedSource(handler);
    bufferedUpdate(2);
    expect(update).toHaveBeenLastCalledWith(2);
    expect(handler).toHaveBeenLastCalledWith(4);
  });

  test('does not send updates when value is equal to last sent value', () => {
    const { bufferedUpdate, update } = makeNonDuplicatingChannel(() => 0);

    bufferedUpdate(2);
    bufferedUpdate(2);
    expect(update).toHaveBeenCalledTimes(1);
  });

  test('does not send updates when value is equal to last received value', () => {
    const { bufferedUpdate, bufferedSource, update, stream } =
      makeNonDuplicatingChannel(() => 0);

    bufferedSource(jest.fn());
    stream.emit(2);
    bufferedUpdate(2);
    expect(update).not.toHaveBeenCalled();
  });

  test('does not skip duplicate values coming from the source', () => {
    const { bufferedSource, stream } = makeNonDuplicatingChannel(() => 0);

    const handler = jest.fn();
    bufferedSource(handler);
    stream.emit(2);
    stream.emit(2);
    expect(handler).toHaveBeenCalledTimes(2);
  });

  test('update with function provides the current value in cache', () => {
    const { bufferedUpdate, update } = makeBufferedChannel(
      undefined,
      () => 123
    );

    bufferedUpdate(456);
    expect(update).toHaveBeenCalledWith(456);
  });
});

describe('makeValueChannel', () => {
  test('evaluates initialValue on first access', () => {
    const initialValue = jest
      .fn<string, []>()
      .mockName('initialValue')
      .mockReturnValue('foo');
    const { subscribe, value, update } = makeValueChannel(initialValue);

    expect(initialValue).not.toHaveBeenCalled();
    update(`${value()}bar`);
    expect(initialValue).toHaveBeenCalled();
    expect(value()).toBe('foobar');
  });
});
