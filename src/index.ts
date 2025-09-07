/**
 * Invoke to unsubscribe from a stream.
 * @public
 */
export type UnsubscribeFn = () => void;

/**
 * Will be called by a stream whenever a new value is available.
 * @public
 */
export type Handler<T> = (v: T) => void;

/**
 * A stream source.
 *
 * This is an ordinary function. Pass a handler to have that handler called by
 * the source whenever a new value is available.
 *
 * Returns a function that unsubscribes the handler from the source
 * @public
 */
export type Source<T> = (handler: Handler<T>) => UnsubscribeFn;

/**
 * A stream operator, converting one source into another.
 *
 * A stream operator takes a source and returns a new source. This is used to
 * alter the values of a stream, to do things like mapping or filtering.
 * An operator can also alter the behavior of a stream by maintaining internal
 * state and making decisions on how to forward calls from a consumer to the
 * source or from the source to a handler.
 *
 * @public
 */
export type Operator<I, O = I> = (source: Source<I>) => Source<O>;

/**
 * Emit one or more values to a stream.
 *
 * @internal
 */
export type Emit<T> = (...values: [T, ...T[]]) => void;

export interface CustomSource<T> extends Source<T> {
  readonly emit: Emit<T>;
  readonly handlers: Set<Handler<T>>;
}

/**
 * Create a stream source from scratch.
 * @param onSubscribe - This callback is invoked after a new handler subscribes
 *                      to this source. The callback is given an emit method that
 *                      can be used to emit values to the new handler.
 * @param onUnsubscribe - This callback is invoked after a a handler unsubscribes.
 * @returns A stream source that has an attached `emit` method and an attach set
 *          of `handlers`.
 * @internal
 */
export function makeSource<T>(
  onSubscribe?: (emitToSubscriber: Emit<T>) => void,
  onUnsubscribe?: () => void,
): CustomSource<T> {
  const handlers: Set<Handler<T>> = new Set();

  function emit(value: T, ...values: T[]): void {
    for (const handler of handlers) {
      handler(value);
      for (const v of values) {
        handler(v);
      }
    }
  }

  function stream(handler: Handler<T>) {
    handlers.add(handler);
    const emitToSubscriber: Emit<T> = (value, ...values) => {
      handler(value);
      for (const v of values) {
        handler(v);
      }
    };
    onSubscribe?.(emitToSubscriber);
    const unsubscribeMakeSource = () => {
      handlers.delete(handler);
      onUnsubscribe?.();
    };
    return unsubscribeMakeSource;
  }

  stream.emit = emit;
  stream.handlers = handlers;

  return stream;
}

/**
 * Filters values out of stream for which the filterFn returns false.
 * @internal
 */
export const filter =
  <T extends any>(filterFn: (e: T) => boolean) =>
  (source: Source<T>) =>
    function subscribeFilter(handler: Handler<T>): UnsubscribeFn {
      return source(function filterHandler(e: T) {
        if (filterFn(e)) {
          handler(e);
        }
      });
    };

/**
 * Map values of a stream using a provided map function.
 * @internal
 */
export const map =
  <I, O>(mapFn: (i: I) => O) =>
  (source: Source<I>) =>
    function subscribeMap(listener: Handler<O>): UnsubscribeFn {
      return source(function mapHandler(e) {
        listener(mapFn(e));
      });
    };

/**
 * Map and potentially unwrap an async value.
 *
 * This can be used with synchronous and asynchronous sources (i.e. plain values
 * or promises), and synchronous or asynchronous map functions.
 * The resulting stream will received unwrapped plain values, but will always
 * receive them asynchronously.
 * @internal
 */
export const mapAsync =
  <I, O = I>(mapFn: (i: I) => O | Promise<O>) =>
  (source: Source<I | Promise<I>>) =>
    function subscribeMapAsync(listener: Handler<O>) {
      let unsubscribed = false;
      const unsubscribeFromSource = source(async function mapAsyncHandler(e) {
        const i = await e;
        if (unsubscribed) return;
        const mapResult = await mapFn(i);
        if (unsubscribed) return;
        listener(mapResult);
      });
      return function unsubscribeMapAsync() {
        unsubscribed = true;
        unsubscribeFromSource();
      };
    };

/**
 * Return a new stream.
 *
 * This stream guarantees that its handlers are invoked at least once.
 * * This invocation happens synchronously after subscribing to the `source`.
 * * If the `source` invokes its handler synchronously during subscription, that value is used during the initial invocation.
 * * If the `source` does _not_ invoke its handler during subscription, the `firstValue` function is used to generate a value to send to the handlers
 *
 * @internal
 */
export function startWith(firstValue?: void): Operator<unknown, void>;
export function startWith<T>(firstValue: T | (() => T)): Operator<T>;
export function startWith<T>(firstValue: T | (() => T)): Operator<T> {
  return (source: Source<T>) =>
    function subscribeStartWith(handler: Handler<T>): UnsubscribeFn {
      let receivedData = false;

      const unsubscribeStartWith = source(function startWithHandler(e) {
        receivedData = true;
        handler(e);
      });

      if (!receivedData) {
        handler(firstValue instanceof Function ? firstValue() : firstValue);
      }

      return unsubscribeStartWith;
    };
}

/**
 * An operator that returns a source unmodified
 * @internal
 */
export const id = <T>(source: Source<T>) => source;

/**
 * @internal
 * @param handlerName
 * @returns
 */
export function name<T>(handlerName?: string) {
  if (!handlerName) return id;

  return (source: Source<T>) => {
    return (handler: Handler<T>) => {
      // https://stackoverflow.com/a/50402530
      const fullname = `emit(${handlerName})`;
      const hack = { [fullname]: handler };
      return source((v) => hack[fullname]!(v));
    };
  };
}

/**
 * Swallows updates and doesn't pass them on, when their value is the same as
 * the value that was passed before.
 *
 * The equals function does not actually have to implement an equivalence
 * relation. It can also be thought of as a "reject" function, that receives
 * the previous and current value.
 * @internal
 */
export const memo =
  <T>(equals = (value: T, lastValue: T | undefined) => value === lastValue) =>
  (source: Source<T>) => {
    return function subscribeMemo(handler: Handler<T>) {
      let lastValue: T;
      return source(function memoHandler(e) {
        if (equals(e, lastValue)) {
          return;
        }
        lastValue = e;
        handler(e);
      });
    };
  };

/**
 * Fans out a source to multiple handlers
 *
 * Normally, if you attach a handler to a source, the entire chain of operators
 * on that source is invoked for every event and every handler.
 *
 * The `fan` operator maintains its own list of handlers and subscribes upstream
 * only once!
 *
 * ```
 * Without Fan:
 *        ┌─► Filter ─► Map ─► Consumer
 * Source │
 *        └─► Filter ─► Map ─► Consumer
 *
 * With Fan:
 *                                ┌─► Consumer
 * Source ─► Filter ─► Map ─► Fan │
 *                                └─► Consumer
 * ```
 *
 * Use this only when needed, since it does bring some overhead with it.
 *
 * The stream returned by this operator will
 * * subscribe to its `source` when the first consumer subscribes to the stream
 * * unsubscribe from the `source` when the last consumer unsubscribes
 * @internal
 */
export const fan = <T>(source: Source<T>) => {
  const handlers = new Set<Handler<T>>();
  let unsubscribe: UnsubscribeFn | null = null;

  return function subscribeFan(handler: Handler<T>) {
    handlers.add(handler);
    if (unsubscribe === null) {
      unsubscribe = source(function fanHandler(e) {
        handlers.forEach((h) => h(e));
      });
    }
    return function unsubscribeFan() {
      handlers.delete(handler);
      if (handlers.size === 0) {
        unsubscribe?.();
        unsubscribe = null;
      }
    };
  };
};

/**
 * Utility type to force evaluation of type T
 * Will cause TypeScript to show an error at the specific point where types mismatch
 */
type Eval<T> = T extends any ? T : never;

/**
 * Allows for easier expression of a series of operators.
 *
 * The first argument should always be a Source, subsequent arguments should be
 * Operators with matching types.
 *
 * `pipe(source, foo, bar)` is the same as `bar(foo(source))`.
 *
 * @returns a source that matches the output type of the last operator
 *
 * @internal
 */
export function pipe<T>(source: Source<T>): Source<T>;
/** @internal */
export function pipe<A, B>(
  source: Source<Eval<A>>,
  ab: typeof source extends Source<infer T> ? Operator<T, Eval<B>> : never,
): Source<B>;
/** @internal */
export function pipe<A, B, C>(
  source: Source<Eval<A>>,
  ab: typeof source extends Source<infer T> ? Operator<T, Eval<B>> : never,
  bc: typeof ab extends Operator<any, infer T> ? Operator<T, Eval<C>> : never,
): Source<C>;
/** @internal */
export function pipe<A, B, C, D>(
  source: Source<Eval<A>>,
  ab: typeof source extends Source<infer T> ? Operator<T, Eval<B>> : never,
  bc: typeof ab extends Operator<any, infer T> ? Operator<T, Eval<C>> : never,
  cd: typeof bc extends Operator<any, infer T> ? Operator<T, Eval<D>> : never,
): Source<D>;
/** @internal */
export function pipe<A, B, C, D, E>(
  source: Source<Eval<A>>,
  ab: typeof source extends Source<infer T> ? Operator<T, Eval<B>> : never,
  bc: typeof ab extends Operator<any, infer T> ? Operator<T, Eval<C>> : never,
  cd: typeof bc extends Operator<any, infer T> ? Operator<T, Eval<D>> : never,
  de: typeof cd extends Operator<any, infer T> ? Operator<T, Eval<E>> : never,
): Source<E>;
/** @internal */
export function pipe<A, B, C, D, E, F>(
  source: Source<Eval<A>>,
  ab: typeof source extends Source<infer T> ? Operator<T, Eval<B>> : never,
  bc: typeof ab extends Operator<any, infer T> ? Operator<T, Eval<C>> : never,
  cd: typeof bc extends Operator<any, infer T> ? Operator<T, Eval<D>> : never,
  de: typeof cd extends Operator<any, infer T> ? Operator<T, Eval<E>> : never,
  ef: typeof de extends Operator<any, infer T> ? Operator<T, Eval<F>> : never,
): Source<F>;
/** @internal */
export function pipe<A, B, C, D, E, F, G>(
  source: Source<Eval<A>>,
  ab: typeof source extends Source<infer T> ? Operator<T, Eval<B>> : never,
  bc: typeof ab extends Operator<any, infer T> ? Operator<T, Eval<C>> : never,
  cd: typeof bc extends Operator<any, infer T> ? Operator<T, Eval<D>> : never,
  de: typeof cd extends Operator<any, infer T> ? Operator<T, Eval<E>> : never,
  ef: typeof de extends Operator<any, infer T> ? Operator<T, Eval<F>> : never,
  fg: typeof ef extends Operator<any, infer T> ? Operator<T, Eval<G>> : never,
): Source<G>;
export function pipe<T>(
  source: Source<any>,
  ...operators: Operator<any>[]
): Source<T> {
  return operators.reduce((res, operator) => operator(res), source);
}

type SourceType<S> = S extends Source<infer T> ? T : never;

/**
 * Merge multiple sources together. Values emitted from any source will
 * immediately be send to handlers.
 * @internal
 */
export const merge = <Sources extends Source<unknown>[]>(
  ...sources: Sources
): Source<SourceType<Sources[number]>> => {
  type T = SourceType<Sources[number]>;
  const savedSources = Array.from(sources) as Source<T>[];
  return function subscribeMerge(handler: Handler<T>) {
    const unsubscribers = savedSources.map(function mergeHandler(source) {
      return source(handler);
    });
    return function unsubscribeMerge() {
      for (const unsub of unsubscribers) {
        unsub();
      }
    };
  };
};

/**
 * Convert a stream of streams of values to a simple stream of values
 *
 * Given a stream source that emits other stream sources, returns a stream that
 * under the hood connects to new stream sources as they come in, without the
 * consumer noticing.
 *
 * ```
 * Input: ---+------+----------
 *           |      > - b - c -
 *           |
 *           > - 1 - 2 - 3 -
 *
 * Output: ----- 1 ---- b - c
 * ```
 *
 * - You might want to combine switchAll with `map` to extract a stream from a
 *   provider before passing it to switchAll.
 * - You might also want to apply the `startWith` operator before
 *   `switchAll`/`map`, so that handler gets a chance subscribe to the underlying
 *   stream, even if the stream provider never emits.
 * - You might also want to apply the `startWith` operator to the emitted
 *   stream inside `map`, so that handlers are guaranteed to be notified if the
 *    underlying stream changes, even if no new value is emitted on it.
 * - If the input stream emits `null` or `undefined` instead of a stream source,
 *   the output stream will suspend and not emit anything until the input stream
 *   emits another stream source.
 *
 * @example
 * ```ts
 * function streamTest<SceneMode>(sceneStream: Source<{mode: Source<SceneMode>}>) {
 *   const modeSource: Source<SceneMode> = pipe(
 *     sceneStream,
 *     // Ensure we have an initial scene to extract the mode channel from
 *     startWith(() => getScene()),
 *     map(scene => {
 *       // Extract the SceneMode stream from the current scene
 *       const modeStream:Source<SceneMode> = scene.mode;
 *       // Ensure that the current scene mode is emitted when switchAll subscribes to the new SceneMode stream
 *       const modeStreamWithStartWith:Source<SceneMode> =
 *         startWith(() => getCurrentMode())(modeStream)
 *       return modeStreamWithStartWith
 *     }),
 *     switchAll
 *   )
 * }
 * ```
 * Here, `modeSource` will be a stream of the latest sceneMode that works when
 * the stream of the latest scene emits a new value.
 *
 * Generally you want to follow this pattern:
 *
 * ```ts
 * pipe(
 *   streamProvider,
 *   startWith(() => currentProviderValue()),
 *   map(extractStreamFromProviderValue),
 *   switchAll
 * )
 * ```
 *
 * @param sourceSource
 * @returns
 */
export function switchAll<T, N extends null | undefined | never = never>(
  sourceSource: Source<Source<T> | N>,
): Source<T> {
  return function subscribeSwitchAll(handler: Handler<T>): UnsubscribeFn {
    let unsubscribeFromSource: UnsubscribeFn | null | undefined = null;
    const unsubscribeFromSourceSource = sourceSource(
      function switchAllHandler(source) {
        // Source has changed:
        // 1. Unsubscribe from previous source
        unsubscribeFromSource?.();
        // 2. Subscribe to new Source
        unsubscribeFromSource = source ? source(handler) : source;
      },
    );

    return function unsubscribeSwitchAll() {
      unsubscribeFromSourceSource();
      unsubscribeFromSource?.();
      unsubscribeFromSource = null;
    };
  };
}

/**
 * Takes two streams and combines their latest values into a new stream.
 *
 * Whenever one of the streams sends an update, a result is generated and
 * emitted from the last values (or `undefined`) received from all sources.  If
 * one source has not emitted a value yet when the other emits, its value will
 * be `undefined` instead.
 *
 * e.g.
 * ```
 * source-A: - 1 ------------- 2 ---------------
 * source-B: --------- b ------------- c -------
 * combined: - [1, ] - [1,b] - [2,b] - [2,c] ---
 * ```
 *
 * @internal
 */
export function combineLatest<Sources extends Source<unknown>[]>(
  ...sources: Sources
): Source<{ [i in keyof Sources]: SourceType<Sources[i]> | undefined }> {
  const ss = Array.from(sources) as typeof sources;
  type T = { [i in keyof Sources]: SourceType<Sources[i]> | undefined };

  return function subscribeCombineLatest(handler: Handler<T>) {
    const currentValues = new Array(ss.length) as T;
    const unsubscribers = ss.map((source, i) =>
      source(function combineLatestHandler(v) {
        currentValues[i] = v;
        handler(currentValues);
      }),
    );
    return function unsubscribeCombineLatest() {
      unsubscribers.forEach((unsubscribe) => unsubscribe());
      currentValues.length = 0;
    };
  };
}

/**
 * Register callbacks to a stream that are called
 * - before an event is emitted
 * - before a handler subscribes
 * - before a handler unsubscribes
 * @internal
 */
export function tap<T>(
  onValue?: (v: T) => void,
  onSubscribe?: (handler: Handler<T>) => void,
  onUnSubscribe?: (handler: Handler<T>) => void,
) {
  return (source: Source<T>) =>
    function subscribeTap(handler: Handler<T>) {
      onSubscribe?.(handler);
      const unsubscribe = source(function tapHandler(v) {
        onValue?.(v);
        handler(v);
      });

      return function unsubscribeTap() {
        onUnSubscribe?.(handler);
        unsubscribe();
      };
    };
}

/**
 * Installs a subscription effect on a stream.
 *
 * The `afterFirstSubscribe` handler is called after the first handler subscribes.
 * It can return a function that will be called after the last handler unsubscribes.
 *
 * This is useful for streams that need to turn on/off some resource when the first
 * handler subscribes and the last handler unsubscribes.
 * @internal
 * @deprecated This is still untested
 */
export function effect<T>(afterFirstSubscribe: () => void | (() => void)) {
  return (source: Source<T>) => {
    let subscribers = 0;
    let unwind: (() => void) | void;
    return function subscribeEffect(handler: Handler<T>) {
      const unsubscribe = source(handler);
      if (subscribers++ === 0) {
        unwind = afterFirstSubscribe();
      }
      return function unsubscribeEffect() {
        if (--subscribers === 0) {
          unwind?.();
          unwind = undefined;
        }
        unsubscribe();
      };
    };
  };
}
