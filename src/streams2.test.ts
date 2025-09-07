/* eslint-disable @typescript-eslint/no-unused-vars */

import test, { describe, mock, type Mock } from "node:test";
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
  type Source,
} from "./index.js";
import assert from "node:assert";

describe("makeSource", () => {
  test("onSubscribe emits to new subscribers only", () => {
    let i = 1;
    const source = makeSource<string>((emit) => emit(`hallo ${i++}`));
    const handler1 = mock.fn();
    const handler2 = mock.fn();
    source(handler1);
    source(handler2);
    assert.partialDeepStrictEqual(handler1.mock.calls[0]?.arguments, [
      "hallo 1",
    ]);
    assert.partialDeepStrictEqual(handler2.mock.calls[0]?.arguments, [
      "hallo 2",
    ]);
  });

  test("emit lets us emit multiple values at once", () => {
    const source = makeSource<string>();
    const handler = mock.fn();
    source(handler);
    source.emit("hallo", "welt");
    assert.partialDeepStrictEqual(handler.mock.calls[0]?.arguments, ["hallo"]);
    assert.partialDeepStrictEqual(handler.mock.calls[1]?.arguments, ["welt"]);
  });

  test("emit will always call handlers, even without argument", () => {
    const source = makeSource<void>();
    const handler = mock.fn();
    source(handler);
    source.emit();
    assert.partialDeepStrictEqual(handler.mock.calls[0]?.arguments, [
      undefined,
    ]);
  });

  test("onSubscribe is called after adding the new handler", (t) => {
    t.plan(2);
    const onSubscribe = mock.fn(() => t.assert.equal(source.handlers.size, 1));
    const source: CustomSource<string> = makeSource<string>(onSubscribe);
    t.assert.equal(source.handlers.size, 0);
    source(() => {});
  });

  test("onUnsubscribe is called after removing a handler", (t) => {
    t.plan(2);
    const onUnsubscribe = mock.fn(() =>
      t.assert.equal(source.handlers.size, 0),
    );
    const source: CustomSource<string> = makeSource<string>(
      undefined,
      onUnsubscribe,
    );
    const unsubscribe = source(() => {});
    unsubscribe();
    t.assert.equal(source.handlers.size, 0);
  });
});

function testOperatorProperties<I, O = I>(operator?: Operator<I, O>) {
  if (!operator) {
    describe.todo("behaves like an operator");
    return;
  }
  describe("behaves like an operator", () => {
    test("does not do anything before subscribing", (t) => {
      const stream: Mock<Source<any>> = mock.fn();
      operator!(stream);
      t.assert.equal(stream.mock.calls.length, 0);
    });
    test("forwards subscriptions and unsubscriptions", (t) => {
      const unsubscribe = mock.fn();
      const stream = mock.fn(() => unsubscribe);
      const streamWithOperator = operator(stream);
      const unsubscribeWithOperator = streamWithOperator(() => ({}));
      t.assert.equal(stream.mock.calls.length, 1);
      t.assert.equal(unsubscribe.mock.calls.length, 0);
      unsubscribeWithOperator();
      t.assert.equal(unsubscribe.mock.calls.length, 1);
    });
  });
}

describe("filter", () => {
  test("filters out non-matching events", () => {
    const stream = makeSource<number>((emit) => {
      emit(1, 2, 3, 4);
    });

    const filteredStream = filter<number>((e) => e > 2)(stream);
    const handler = mock.fn();
    filteredStream(handler);
    assert.partialDeepStrictEqual(handler.mock.calls[0]?.arguments, [3]);
    assert.partialDeepStrictEqual(handler.mock.calls[1]?.arguments, [4]);
  });
  testOperatorProperties(filter(() => true));
});

describe("map", () => {
  test("maps incoming events", () => {
    const stream = makeSource<number>((emit) => {
      emit(1, 2, 3, 4);
    });
    const mappedStream = map((n: number) => n * 2)(stream);
    const handler = mock.fn();
    mappedStream(handler);
    assert.partialDeepStrictEqual(handler.mock.calls[0]?.arguments, [2]);
    assert.partialDeepStrictEqual(handler.mock.calls[1]?.arguments, [4]);
    assert.partialDeepStrictEqual(handler.mock.calls[2]?.arguments, [6]);
    assert.partialDeepStrictEqual(handler.mock.calls[3]?.arguments, [8]);
  });
  testOperatorProperties(map((x) => x));
});

describe("mapAsync", () => {
  test("unwraps promises in source and mapFn", (t, done) => {
    const stream = makeSource<Promise<number>>();
    const mappedStream = mapAsync<number>((n) => Promise.resolve(n * 2))(
      stream,
    );
    const handler = (v: number) => {
      assert.equal(v, 4);
      done();
    };
    mappedStream(handler);
    stream.emit(Promise.resolve(2));
  });

  test("works with regular values", (t, done) => {
    t.plan(1);
    const stream = makeSource<number>();
    const mappedStream = mapAsync<number>((n) => n * 2)(stream);
    const handler = (v: number) => {
      t.assert.equal(v, 4);
      done();
    };
    mappedStream(handler);
    stream.emit(2);
  });

  test("is always asynchronous", (t, done) => {
    t.plan(2);
    const stream = makeSource<number>();
    const mappedStream = mapAsync<number>((n) => n * 2)(stream);
    const handler = mock.fn((v: number) => {
      t.assert.equal(v, 4);
      done();
    });
    mappedStream(handler);
    stream.emit(2);
    t.assert.equal(handler.mock.calls.length, 0);
  });

  test("does not emit or call mapFn when handler is unsubscribed", async () => {
    const stream = makeSource<Promise<number>>();

    const valuePromise = makeDeferred<number>();
    const mapPromise = makeDeferred<number>();

    const mapFn = mock.fn((n: number) => mapPromise);

    const mappedStream = mapAsync<number>(mapFn)(stream);

    const handlerA = mock.fn();
    const handlerB = mock.fn();
    const unsubscribeA = mappedStream(handlerA);
    const unsubscribeB = mappedStream(handlerB);
    stream.emit(valuePromise);

    // unsubscribe A before the value promise is resolved
    unsubscribeA();
    await valuePromise.resolve(2);

    assert.equal(mapFn.mock.calls.length, 1);
    assert.equal(handlerA.mock.calls.length, 0);
    assert.equal(handlerB.mock.calls.length, 0);

    // unsubscribe B before the map promise is resolved
    unsubscribeB();
    await mapPromise.resolve(4);

    assert.equal(mapFn.mock.calls.length, 1);
    assert.equal(handlerA.mock.calls.length, 0);
    assert.equal(handlerB.mock.calls.length, 0);

    function makeDeferred<T>(): Promise<T> & { resolve: (n: T) => Promise<T> } {
      let resolve: (value: T) => Promise<T>;
      const promise: Promise<T> & { resolve: (n: T) => Promise<T> } = {
        ...new Promise<T>((r) => {
          resolve = (n) => {
            r(n);
            return promise;
          };
        }),
        resolve: (n) => resolve(n),
      };
      return promise;
    }
  });

  testOperatorProperties(mapAsync((x) => x));
});

describe("kickoff", () => {
  test("invokes handler immediately with provided value", () => {
    const stream = makeSource<number>();
    const handler = mock.fn();
    const kickoffStream = startWith(123)(stream);
    kickoffStream(handler);
    assert.equal(handler.mock.calls[0]?.arguments[0], 123);
    stream.emit(1);
    assert.equal(handler.mock.calls[1]?.arguments[0], 1);
  });

  test("does not use kickoff value when sync value coming from source", () => {
    const stream = makeSource<number>((e) => e(666));
    const handler = mock.fn();
    const startWithProvider = mock.fn(() => 123);
    const kickoffStream = startWith(startWithProvider)(stream);
    kickoffStream(handler);
    stream.emit(777);
    assert.equal(handler.mock.calls[0]?.arguments[0], 666);
    assert.equal(handler.mock.calls[1]?.arguments[0], 777);
    assert.equal(startWithProvider.mock.calls.length, 0);
  });

  testOperatorProperties(startWith(123));
});

describe("memo", () => {
  test("emits once for two identical updates in a row", () => {
    const stream = makeSource<number>((e) => e(1, 2, 2, 3));
    const handler = mock.fn();
    const memoStream = memo()(stream);
    memoStream(handler);
    assert.partialDeepStrictEqual(handler.mock.calls, [
      { arguments: [1] },
      { arguments: [2] },
      { arguments: [3] },
    ]);
    stream.emit(2);
    assert.partialDeepStrictEqual(handler.mock.calls, [
      { arguments: [1] },
      { arguments: [2] },
      { arguments: [3] },
      { arguments: [2] },
    ]);
  });

  test("compares with passed values, not received values", () => {
    const stream = makeSource<number>((e) => e(1, 2, 3, 4, 3, 4, 5));
    const handler = mock.fn();
    const increasingStream = memo<number>((value, prev) =>
      prev === undefined ? false : value <= prev,
    )(stream);
    increasingStream(handler);
    assert.partialDeepStrictEqual(handler.mock.calls, [
      { arguments: [1] },
      { arguments: [2] },
      { arguments: [3] },
      { arguments: [4] },
      { arguments: [5] },
    ]);
  });

  test("works with two subscribers", () => {
    const stream = makeSource<number>();
    const handler1 = mock.fn();
    const handler2 = mock.fn();
    const memoStream = memo()(stream);
    memoStream(handler1);
    memoStream(handler2);

    stream.emit(1);
    stream.emit(1);
    assert.partialDeepStrictEqual(handler1.mock.calls, [{ arguments: [1] }]);
    assert.partialDeepStrictEqual(handler2.mock.calls, [{ arguments: [1] }]);
  });

  testOperatorProperties(memo());
});

describe("fan", () => {
  test("subscribes only once to the source, for two consumers", () => {
    const stream = makeSource();
    const fannedStream = fan(stream);
    const handler1 = mock.fn();
    const handler2 = mock.fn();
    fannedStream(handler1);
    fannedStream(handler2);
    assert.equal(stream.handlers.size, 1);
    stream.emit(1);
    assert.notEqual(handler1.mock.calls.length, 0);
    assert.notEqual(handler2.mock.calls.length, 0);
  });

  test("subscribes with the first consumer", () => {
    const stream = makeSource();
    const fannedStream = fan(stream);
    const handler1 = mock.fn();
    const handler2 = mock.fn();
    fannedStream(handler1);
    fannedStream(handler2);
    assert.equal(stream.handlers.size, 1);
  });

  test("unsubscribes with the last consumer", () => {
    const stream = makeSource();
    const fannedStream = fan(stream);
    const handler1 = mock.fn();
    const handler2 = mock.fn();
    const unsub1 = fannedStream(handler1);
    const unsub2 = fannedStream(handler2);
    assert.equal(stream.handlers.size, 1);
    unsub1();
    assert.equal(stream.handlers.size, 1);
    unsub2();
    assert.equal(stream.handlers.size, 0);
  });
  testOperatorProperties(fan);
});

describe("pipe", () => {
  test("piping operators together itself doesn't do anything to the source", () => {
    const stream = makeSource<number>();
    const streamSpy = mock.fn(stream);

    const filteredStream = pipe(
      streamSpy,
      filter((n) => n > 2),
      map((n) => n * 2),
    );

    assert.equal(streamSpy.mock.calls.length, 0);
  });
});

describe("merge", () => {
  test("subscribes to all on subscription", () => {
    const onSubscribeA = mock.fn();
    const onSubscribeB = mock.fn();
    const a = makeSource<string>(onSubscribeA);
    const b = makeSource<number>(onSubscribeB);
    const merged = merge(a, b);
    merged(() => {});
    assert.equal(onSubscribeA.mock.calls.length, 1);
    assert.equal(onSubscribeB.mock.calls.length, 1);
  });

  test("unsubscribes from all on unsubscribe", () => {
    const onUnsubscribeA = mock.fn();
    const onUnsubscribeB = mock.fn();
    const a = makeSource<string>(undefined, onUnsubscribeA);
    const b = makeSource<number>(undefined, onUnsubscribeB);
    const merged = merge(a, b);
    const unsubscribe = merged(() => {});
    unsubscribe();
    assert.equal(onUnsubscribeA.mock.calls.length, 1);
    assert.equal(onUnsubscribeB.mock.calls.length, 1);
  });

  test("receives events from all", () => {
    const a = makeSource<string>();
    const b = makeSource<number>();
    const merged = merge(a, b);
    const handler = mock.fn();
    merged(handler);
    a.emit("a");
    b.emit(123);
    assert.partialDeepStrictEqual(handler.mock.calls, [
      { arguments: ["a"] },
      { arguments: [123] },
    ]);
  });
});

describe("switchAll", () => {
  test("it will switch streams", () => {
    const a = makeSource<string>();
    const b = makeSource<string>();
    const ab = makeSource<Source<string>>();
    const handler = mock.fn();
    switchAll(ab)(handler);

    a.emit("a1");
    b.emit("b1");
    assert.equal(handler.mock.calls.length, 0);

    ab.emit(a);
    a.emit("a2");
    b.emit("b2");
    assert(handler.mock.calls.some((call) => call.arguments[0] === "a2"));
    assert(handler.mock.calls.every((call) => call.arguments[0] !== "b2"));

    ab.emit(b);
    a.emit("a3");
    b.emit("b3");
    assert(handler.mock.calls.every((call) => call.arguments[0] !== "a3"));
    assert(handler.mock.calls.some((call) => call.arguments[0] === "b3"));
  });

  test("switching the stream will not emit an event", () => {
    const a = makeSource<string>();
    const ab = makeSource<Source<string>>();
    const handler = mock.fn();
    switchAll(ab)(handler);

    ab.emit(a);
    assert.equal(handler.mock.calls.length, 0);
  });

  test("it will switch off an on by emitting undefined", () => {
    const a = makeSource<string>();
    const b = makeSource<string>();
    const ab = makeSource<Source<string> | undefined>();
    const handler = mock.fn();
    switchAll(ab)(handler);

    ab.emit(a);
    a.emit("a1");
    b.emit("b1");
    assert(handler.mock.calls.some((call) => call.arguments[0] === "a1"));
    assert(handler.mock.calls.every((call) => call.arguments[0] !== "b1"));

    ab.emit(undefined);
    a.emit("a2");
    b.emit("b2");
    assert(handler.mock.calls.every((call) => call.arguments[0] !== "a2"));
    assert(handler.mock.calls.every((call) => call.arguments[0] !== "b2"));

    ab.emit(b);
    a.emit("a3");
    b.emit("b3");
    assert(handler.mock.calls.every((call) => call.arguments[0] !== "a3"));
    assert(handler.mock.calls.some((call) => call.arguments[0] === "b3"));
  });

  test("Switching a stream to an eager stream will emit", () => {
    const stream = makeSource<string>();
    const streamStream = makeSource<Source<string> | undefined>();
    const handler = mock.fn();

    const switchedStream = pipe(
      streamStream,
      map((s) => s && startWith("start")(s)),
      switchAll,
    );
    switchedStream(handler);
    streamStream.emit(stream);
    assert(handler.mock.calls.some((call) => call.arguments[0] === "start"));
  });

  test("Switching an eager streamStream to undefined will not emit", () => {
    const stream = makeSource<string>();
    const streamStream = makeSource<Source<string> | undefined>();
    const handler = mock.fn();

    const switchedStream = pipe(
      streamStream,
      startWith<Source<string> | undefined>(undefined),
      map((s) => s && startWith("start")(s)),
      switchAll,
    );
    switchedStream(handler);
    assert.equal(handler.mock.calls.length, 0);
    streamStream.emit(undefined);
    assert.equal(handler.mock.calls.length, 0);
  });
});
