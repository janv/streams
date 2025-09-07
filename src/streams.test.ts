/* eslint-disable @typescript-eslint/no-unused-vars */

import {
  combineLatest,
  fan,
  filter,
  makeSource,
  map,
  mapAsync,
  memo,
  merge,
  pipe,
  startWith,
  switchAll,
  type CustomSource,
  type Operator,
  type Source
} from './index.js';

describe('makeSource', () => {
  test('onSubscribe emits to new subscribers only', () => {
    let i = 1;
    const source = makeSource<string>((emit) => emit(`hallo ${i++}`));
    const handler1 = jest.fn();
    const handler2 = jest.fn();
    source(handler1);
    source(handler2);
    expect(handler1.mock.calls).toMatchObject([['hallo 1']]);
    expect(handler2.mock.calls).toMatchObject([['hallo 2']]);
  });

  test('emit lets us emit multiple values at once', () => {
    const source = makeSource<string>();
    const handler = jest.fn();
    source(handler);
    source.emit('hallo', 'welt');
    expect(handler.mock.calls).toMatchObject([['hallo'], ['welt']]);
  });

  test('emit will always call handlers, even without argument', () => {
    const source = makeSource<void>();
    const handler = jest.fn();
    source(handler);
    source.emit();
    expect(handler).toHaveBeenCalled();
    expect(handler).toHaveBeenCalledWith(undefined);
  });

  test('onSubscribe is called after adding the new handler', () => {
    const onSubscribe = jest.fn(() => expect(source.handlers.size).toBe(1));
    const source: CustomSource<string> = makeSource<string>(onSubscribe);
    expect(source.handlers.size).toBe(0);
    source(() => {});
    expect.assertions(2);
  });

  test('onUnsubscribe is called after removing a handler', () => {
    const onUnsubscribe = jest.fn(() => expect(source.handlers.size).toBe(0));
    const source: CustomSource<string> = makeSource<string>(
      undefined,
      onUnsubscribe
    );
    const unsubscribe = source(() => {});
    unsubscribe();
    expect(source.handlers.size).toBe(0);
    expect.assertions(2);
  });
});

function testOperatorProperties<I, O = I>(operator?: Operator<I, O>) {
  const maybeTest = operator ? test : (name: string) => test.todo(name);
  describe('behaves like an operator', () => {
    maybeTest('does not do anything before subscribing', () => {
      const stream = jest.fn();
      operator!(stream);
      expect(stream).not.toHaveBeenCalled();
    });
    maybeTest('forwards subscriptions and unsubscriptions', () => {
      const unsubscribe = jest.fn();
      const stream = jest.fn(() => unsubscribe);
      const streamWithOperator = operator!(stream);
      const unsubscribeWithOperator = streamWithOperator(() => ({}));
      expect(stream).toHaveBeenCalledTimes(1);
      expect(unsubscribe).toHaveBeenCalledTimes(0);
      unsubscribeWithOperator();
      expect(unsubscribe).toHaveBeenCalledTimes(1);
    });
  });
}

describe('filter', () => {
  test('filters out non-matching events', () => {
    const stream = makeSource<number>((emit) => {
      emit(1, 2, 3, 4);
    });

    const filteredStream = filter<number>((e) => e > 2)(stream);
    const handler = jest.fn();
    filteredStream(handler);
    expect(handler.mock.calls).toMatchObject([[3], [4]]);
  });
  testOperatorProperties(filter(() => true));
});

describe('map', () => {
  test('maps incoming events', () => {
    const stream = makeSource<number>((emit) => {
      emit(1, 2, 3, 4);
    });
    const mappedStream = map((n: number) => n * 2)(stream);
    const handler = jest.fn();
    mappedStream(handler);
    expect(handler.mock.calls).toMatchObject([[2], [4], [6], [8]]);
  });
  testOperatorProperties(map((x) => x));
});

describe('mapAsync', () => {
  test('unwraps promises in source and mapFn', (done) => {
    const stream = makeSource<Promise<number>>();
    const mappedStream = mapAsync<number>((n) => Promise.resolve(n * 2))(
      stream
    );
    const handler = (v: number) => {
      expect(v).toBe(4);
      done();
    };
    mappedStream(handler);
    stream.emit(Promise.resolve(2));
  });

  test('works with regular values', (done) => {
    const stream = makeSource<number>();
    const mappedStream = mapAsync<number>((n) => n * 2)(stream);
    const handler = (v: number) => {
      expect(v).toBe(4);
      done();
    };
    mappedStream(handler);
    stream.emit(2);
  });

  test('is always asynchronous', (done) => {
    const stream = makeSource<number>();
    const mappedStream = mapAsync<number>((n) => n * 2)(stream);
    const handler = jest.fn((v: number) => {
      expect(v).toBe(4);
      done();
    });
    mappedStream(handler);
    stream.emit(2);
    expect(handler).not.toBeCalled();
  });

  test('does not emit or call mapFn when handler is unsubscribed', async () => {
    const stream = makeSource<Promise<number>>();

    const valuePromise = makeDeferred<number>();
    const mapPromise = makeDeferred<number>();

    const mapFn = jest.fn((n: number) => mapPromise);

    const mappedStream = mapAsync<number>(mapFn)(stream);

    const handlerA = jest.fn();
    const handlerB = jest.fn();
    const unsubscribeA = mappedStream(handlerA);
    const unsubscribeB = mappedStream(handlerB);
    stream.emit(valuePromise);

    // unsubscribe A before the value promise is resolved
    unsubscribeA();
    await valuePromise.resolve(2);

    expect(mapFn).toBeCalledTimes(1);
    expect(handlerA).not.toBeCalled();
    expect(handlerB).not.toBeCalled();

    // unsubscribe B before the map promise is resolved
    unsubscribeB();
    await mapPromise.resolve(4);

    expect(mapFn).toBeCalledTimes(1);
    expect(handlerA).not.toBeCalled();
    expect(handlerB).not.toBeCalled();

    function makeDeferred<T>(): Promise<T> & { resolve: (n: T) => Promise<T> } {
      let resolve: (value: T) => Promise<T>;
      const promise: Promise<T> & { resolve: (n: T) => Promise<T> } = {
        ...new Promise<T>((r) => {
          resolve = (n) => {
            r(n);
            return promise;
          };
        }),
        resolve: (n) => resolve(n)
      };
      return promise;
    }
  });

  testOperatorProperties(mapAsync((x) => x));
});

describe('kickoff', () => {
  test('invokes handler immediately with provided value', () => {
    const stream = makeSource<number>();
    const handler = jest.fn();
    const kickoffStream = startWith(123)(stream);
    kickoffStream(handler);
    expect(handler).toHaveBeenCalledWith(123);
    stream.emit(1);
    expect(handler).toHaveBeenCalledWith(1);
  });

  test('does not use kickoff value when sync value coming from source', () => {
    const stream = makeSource<number>((e) => e(666));
    const handler = jest.fn();
    const startWithProvider = jest.fn(() => 123);
    const kickoffStream = startWith(startWithProvider)(stream);
    kickoffStream(handler);
    stream.emit(777);
    expect(handler).toHaveBeenCalledWith(666);
    expect(handler).toHaveBeenCalledWith(777);
    expect(startWithProvider).not.toHaveBeenCalled();
  });

  testOperatorProperties(startWith(123));
});

describe('memo', () => {
  test('emits once for two identical updates in a row', () => {
    const stream = makeSource<number>((e) => e(1, 2, 2, 3));
    const handler = jest.fn();
    const memoStream = memo()(stream);
    memoStream(handler);
    expect(handler.mock.calls).toMatchObject([[1], [2], [3]]);
    stream.emit(2);
    expect(handler.mock.calls).toMatchObject([[1], [2], [3], [2]]);
  });

  test('compares with passed values, not received values', () => {
    const stream = makeSource<number>((e) => e(1, 2, 3, 4, 3, 4, 5));
    const handler = jest.fn();
    const increasingStream = memo<number>((value, prev) =>
      prev === undefined ? false : value <= prev
    )(stream);
    increasingStream(handler);
    expect(handler.mock.calls).toMatchObject([[1], [2], [3], [4], [5]]);
  });

  test('works with two subscribers', () => {
    const stream = makeSource<number>();
    const handler1 = jest.fn().mockName('handler1');
    const handler2 = jest.fn().mockName('handler2');
    const memoStream = memo()(stream);
    memoStream(handler1);
    memoStream(handler2);

    stream.emit(1);
    stream.emit(1);
    expect(handler1).toBeCalledTimes(1);
    expect(handler2).toBeCalledTimes(1);
  });

  testOperatorProperties(memo());
});

describe('fan', () => {
  test('subscribes only once to the source, for two consumers', () => {
    const stream = makeSource();
    const fannedStream = fan(stream);
    const handler1 = jest.fn();
    const handler2 = jest.fn();
    fannedStream(handler1);
    fannedStream(handler2);
    expect(stream.handlers.size).toBe(1);
    stream.emit(1);
    expect(handler1).toHaveBeenCalled();
    expect(handler2).toHaveBeenCalled();
  });

  test('subscribes with the first consumer', () => {
    const stream = makeSource();
    const fannedStream = fan(stream);
    const handler1 = jest.fn();
    const handler2 = jest.fn();
    fannedStream(handler1);
    fannedStream(handler2);
    expect(stream.handlers.size).toBe(1);
  });

  test('unsubscribes with the last consumer', () => {
    const stream = makeSource();
    const fannedStream = fan(stream);
    const handler1 = jest.fn();
    const handler2 = jest.fn();
    const unsub1 = fannedStream(handler1);
    const unsub2 = fannedStream(handler2);
    expect(stream.handlers.size).toBe(1);
    unsub1();
    expect(stream.handlers.size).toBe(1);
    unsub2();
    expect(stream.handlers.size).toBe(0);
  });
  testOperatorProperties(fan);
});

describe('pipe', () => {
  test("piping operators together itself doesn't do anything to the source", () => {
    const stream = makeSource<number>();
    const streamSpy = jest.fn(stream);

    const filteredStream = pipe(
      streamSpy,
      filter((n) => n > 2),
      map((n) => n * 2)
    );

    expect(streamSpy).not.toHaveBeenCalled();
  });
});

describe('merge', () => {
  it('subscribes to all on subscription', () => {
    const onSubscribeA = jest.fn();
    const onSubscribeB = jest.fn();
    const a = makeSource<string>(onSubscribeA);
    const b = makeSource<number>(onSubscribeB);
    const merged = merge(a, b);
    merged(() => {});
    expect(onSubscribeA).toBeCalled();
    expect(onSubscribeB).toBeCalled();
  });

  it('unsubscribes from all on unsubscribe', () => {
    const onUnsubscribeA = jest.fn();
    const onUnsubscribeB = jest.fn();
    const a = makeSource<string>(undefined, onUnsubscribeA);
    const b = makeSource<number>(undefined, onUnsubscribeB);
    const merged = merge(a, b);
    const unsubscribe = merged(() => {});
    unsubscribe();
    expect(onUnsubscribeA).toBeCalled();
    expect(onUnsubscribeB).toBeCalled();
  });

  it('receives events from all', () => {
    const a = makeSource<string>();
    const b = makeSource<number>();
    const merged = merge(a, b);
    const handler = jest.fn();
    merged(handler);
    a.emit('a');
    b.emit(123);
    expect(handler).toBeCalledWith('a');
    expect(handler).toBeCalledWith(123);
  });
});

describe('switchAll', () => {
  test('it will switch streams', () => {
    const a = makeSource<string>();
    const b = makeSource<string>();
    const ab = makeSource<Source<string>>();
    const handler = jest.fn();
    switchAll(ab)(handler);

    a.emit('a1');
    b.emit('b1');
    expect(handler).not.toBeCalled();

    ab.emit(a);
    a.emit('a2');
    b.emit('b2');
    expect(handler).toBeCalledWith('a2');
    expect(handler).not.toBeCalledWith('b2');

    ab.emit(b);
    a.emit('a3');
    b.emit('b3');
    expect(handler).not.toBeCalledWith('a3');
    expect(handler).toBeCalledWith('b3');
  });

  test('switching the stream will not emit an event', () => {
    const a = makeSource<string>();
    const ab = makeSource<Source<string>>();
    const handler = jest.fn();
    switchAll(ab)(handler);

    ab.emit(a);
    expect(handler).not.toBeCalled();
  });

  test('it will switch off an on by emitting undefined', () => {
    const a = makeSource<string>();
    const b = makeSource<string>();
    const ab = makeSource<Source<string> | undefined>();
    const handler = jest.fn();
    switchAll(ab)(handler);

    ab.emit(a);
    a.emit('a1');
    b.emit('b1');
    expect(handler).toBeCalledWith('a1');
    expect(handler).not.toBeCalledWith('b1');

    ab.emit(undefined);
    a.emit('a2');
    b.emit('b2');
    expect(handler).not.toBeCalledWith('a2');
    expect(handler).not.toBeCalledWith('b2');

    ab.emit(b);
    a.emit('a3');
    b.emit('b3');
    expect(handler).not.toBeCalledWith('a3');
    expect(handler).toBeCalledWith('b3');
  });

  test('Switching a stream to an eager stream will emit', () => {
    const stream = makeSource<string>();
    const streamStream = makeSource<Source<string> | undefined>();
    const handler = jest.fn();

    const switchedStream = pipe(
      streamStream,
      map((s) => s && startWith('start')(s)),
      switchAll
    );
    switchedStream(handler);
    streamStream.emit(stream);
    expect(handler).toBeCalledWith('start');
  });

  test('Switching an eager streamStream to undefined will not emit', () => {
    const stream = makeSource<string>();
    const streamStream = makeSource<Source<string> | undefined>();
    const handler = jest.fn();

    const switchedStream = pipe(
      streamStream,
      startWith<Source<string> | undefined>(undefined),
      map((s) => s && startWith('start')(s)),
      switchAll
    );
    switchedStream(handler);
    expect(handler).not.toBeCalled();
    streamStream.emit(undefined);
    expect(handler).not.toBeCalled();
  });
});

describe('combineLatest', () => {
  test('an event on any source will emit a new combined event', () => {
    const a = makeSource<string>();
    const b = makeSource<string>();
    const handler = jest.fn();
    combineLatest(a, b)(handler);

    a.emit('a1');
    expect(handler).toBeCalledWith(['a1', undefined]);
    handler.mockClear();

    b.emit('b2');
    expect(handler).toBeCalledWith(['a1', 'b2']);
  });
});

// TODO weird corner cases, where stuff happens during subscription or subscriptions
//      happen during processing
