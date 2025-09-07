import { makeSource, type Handler, type Source } from "./index.js";

/**
 * A Channel represents a reactive data source consisting of three elements:
 *
 * * A `subscribe` method to register a callback for values coming from the
 *   data source. Calling this method returns an `unsubscribe` method.
 * * An (optional) `update` method to update the data source
 * * An (optional) synchronous `value` method that can be used to retrieve
 *   the current value.
 * @public
 */
export interface Channel<Out, In = Out> {
  subscribe: Source<Out>;
  update?: ((v: In) => void) | undefined;
  value?: (() => Out) | undefined;
}

/**
 * A {@link Channel} that is guaranteed to have a `value` method
 * @public
 */
export interface ChannelSync<Out, In = Out> extends Channel<Out, In> {
  subscribe: Source<Out>;
  update?: ((v: In) => void) | undefined;
  value: () => Out;
}

/**
 * A Read only {@link Channel}
 * @public
 */
export interface ReadOnlyChannel<Out> extends Omit<Channel<Out>, "update"> {
  subscribe: Source<Out>;
  value?: (() => Out) | undefined;
}

/**
 * A {@link ReadOnlyChannel} that is guaranteed to have a `value`
 * @public
 */
export interface ReadOnlyChannelSync<Out>
  extends Omit<ChannelSync<Out>, "update">,
    ReadOnlyChannel<Out> {
  subscribe: Source<Out>;
  value: () => Out;
}

/**
 * A {@link Channel} that is guaranteed to have an `update` method.
 * @public
 */
export interface ReadWriteChannel<Out, In = Out> extends Channel<Out, In> {
  subscribe: Source<Out>;
  update: (v: In) => void;
  value?: (() => Out) | undefined;
}

/**
 * A {@link ReadWriteChannel} that is guaranteed to have a `value` and an `update` method
 * @public
 */
export interface ReadWriteChannelSync<Out, In = Out>
  extends ChannelSync<Out, In>,
    ReadWriteChannel<Out, In> {
  subscribe: Source<Out>;
  update: (v: In) => void;
  value: () => Out;
}

/** @internal */
const NO_VALUE = Symbol("NO_VALUE");

/**
 * Makes sure that a value sent to the Channel's `update` method is immediately
 * and synchronously sent to the Channel's stream, even if the actual channel
 * source is asynchronous.
 * The use case would be to update UI state immediately after sending the update
 * to the engine, without waiting for the value to make a complete round-trip.
 *
 * This way we can guarantee synchronous behavior of the channel, even if the
 * underlying source is asynchronous.
 *
 * The value type T being a function is undefined behavior
 *
 * @param isValueEqual - When provided, prevent subsequent updates that are equal
 *                       to the value in cache
 * @internal
 * @deprecated This was built at a time when a lot of our APIs were asynchronous
 * and it was supposed to handle cases where there was no way to synchronously
 * get a value for a certain channel. It is not needed anymore but left here for now
 * because we might be able to modify and repurpose it, maybe merge it with `makeChannel.ts`
 * TODO It's weird that the value of a syncBuffer channel does bypass the internal cache
 * TODO It's weird that the update function of a syncBuffer channel is immediately invoked
 */
export function syncBuffer<T>(
  source: ReadWriteChannel<T>,
  isValueEqual: (a: T, b: T) => boolean = () => false,
): ReadWriteChannelSync<T | undefined, T> {
  let value: T | typeof NO_VALUE = NO_VALUE;

  return {
    subscribe: (handler: Handler<T>) =>
      source.subscribe((e) => {
        value = e;
        handler(e);
      }),
    update: (newValue: T) => {
      if (value !== NO_VALUE && isValueEqual(newValue, value)) return;
      value = newValue;
      source.update(newValue);
    },
    value: () => {
      return value === NO_VALUE ? undefined : value;
    },
  };
}

/**
 * Create a channel around a single value
 * @param initialValue - A factory for an initial value
 * @internal
 */
export function makeValueChannel<T>(
  initialValue: () => T,
): ReadWriteChannelSync<T> {
  let currentValue: T | typeof NO_VALUE = NO_VALUE;

  const value = (): T => {
    if (currentValue === NO_VALUE) {
      currentValue = initialValue();
    }
    return currentValue;
  };

  const subscribe = makeSource<T>();

  return {
    subscribe,
    value,
    update(newValue) {
      currentValue = newValue;
      subscribe.emit(currentValue as T);
    },
  };
}
