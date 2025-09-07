import { useEffect, useReducer, useRef } from "react";
import type {
  Channel,
  ChannelSync,
  ReadOnlyChannel,
  ReadOnlyChannelSync,
  ReadWriteChannel,
  ReadWriteChannelSync,
} from "../Channel.js";

const noop = () => {};

type FALSY = 0 | "" | false | null | undefined;

/**
 * A ReadWrite Channel plus an explicit initial value.
 *
 * Guarantees that a value, and an update function of the right type are
 * synchronously returned
 */
function useChannel<Out, In = Out>(
  channel: ReadWriteChannel<Out, In> | FALSY,
  defaultValue: Out | (() => Out),
): [value: Out, update: (v: In) => void];

/**
 * A ReadWriteChannelSync, containing a synchronous value function
 *
 * Guarantees that a value, and an update function of the right type are
 * synchronously returned
 */
function useChannel<Out, In = Out>(
  channel: ReadWriteChannelSync<Out, In>,
  defaultValue?: Out | (() => Out),
): [value: Out, update: (v: In) => void];

/**
 * A ReadWrite Channel without an explicit initial value.
 * The channel itself might provide a synchronous value, but there's no way
 * to statically guarantee that.
 *
 * Guarantees an update function of the right type are is returned. Can not
 * guarantee that a valid value is available at all times.
 */
function useChannel<Out, In = Out>(
  channel: ReadWriteChannel<Out, In> | FALSY,
): [value: Out | undefined, update: (v: In) => void];

/**
 * A Read only Channel plus an explicit initial value.
 *
 * Guarantees that a value of the right type is synchronously returned
 */
function useChannel<Out>(
  channel: ReadOnlyChannel<Out> | FALSY,
  defaultValue: Out | (() => Out),
): [value: Out];

/**
 * A Read only channel, containing a synchronous value function
 *
 * Guarantees that a value of the right type is synchronously returned
 */
function useChannel<Out>(
  channel: ReadOnlyChannelSync<Out>,
  defaultValue?: Out | (() => Out),
): [value: Out];

/**
 * A Read Channel without an explicit initial value.
 * The channel itself might provide a synchronous value, but there's no way
 * to statically guarantee that.
 *
 * Can not guarantee that a valid value is available at all times.
 */
function useChannel<Out>(
  channel: ReadOnlyChannel<Out> | FALSY,
): [value: Out | undefined];

/**
 * A Channel with an explicit initial value.
 *
 * Guarantees that a value  of the right type is synchronously returned.
 * Can not guarantee that the channel provides an update function.
 */
function useChannel<Out, In = Out>(
  channel: Channel<Out, In> | FALSY,
  defaultValue: Out | (() => Out),
): [value: Out, update?: (v: In) => void];

/**
 * A ChannelSync containing a synchronous value function
 *
 * Guarantees that a value  of the right type is synchronously returned.
 * Can not guarantee that the channel provides an update function.
 */
function useChannel<Out, In = Out>(
  channel: ChannelSync<Out, In>,
  defaultValue?: Out | (() => Out),
): [value: Out, update?: (v: In) => void];

/**
 * A channel without an explicit initial value.
 *
 * Can guarantee neither the presence of a valid value synchronously, nor of
 * an available update function.
 */
function useChannel<Out, In = Out>(
  channel: Channel<Out, In> | FALSY,
): [value: Out | undefined, update?: ((v: In) => void) | undefined];

function useChannel<Out, In = Out>(
  channel: Channel<Out, In> | FALSY,
  defaultValue?: Out | (() => Out),
): [value: Out | undefined, update?: ((v: In) => void) | undefined] {
  const [state, dispatch] = useReducer(
    reducer as Reducer<Out, In>,
    { value: undefined },
    () => ({
      value:
        channel && channel.value ? channel.value() : callOrReturn(defaultValue),
    }),
  );

  // Notice when the channel has changed
  const chan = useRef(channel);
  const channelChanged = chan.current !== channel;
  chan.current = channel;

  useEffect(() => {
    dispatch({ channel: channel || undefined });
    if (!channel) return noop;
    return channel.subscribe(function useChannelHandler(value) {
      dispatch({ value });
    });
  }, [channel]);

  // If the channel is synchronous, always return value()
  if (channel && channel?.value) {
    return [channel.value(), channel.update];
  }

  // If we changed to an async channel or no channel, return the current defaultValue
  if (channelChanged || !channel || state.stale) {
    return [callOrReturn(defaultValue), channel ? channel.update : undefined];
  }

  // Return the last value the async channel received
  return [state.value, channel?.update];
}

function callOrReturn<T>(x: (() => T) | T): T {
  if (x instanceof Function) {
    return x();
  } else {
    return x;
  }
}

type ReducerState<Out> = {
  /** The last value that was received via the subscription */
  value: Out | undefined;

  /**
   * If this is true, that means that the last value stored in `value`
   * is invalid/outdated.
   */
  stale?: boolean;
};

/**
 * - `{value}` informs the reducer about a new value
 * - `{channel}` informs the reducer about a new channel
 * - The `_id` fields are for debugging purposes only
 */
type Action<Out, In> =
  | { _id?: string; value: Out }
  | { _id?: string; channel: Channel<Out, In> | undefined };

type Reducer<Out, In> = (
  reducerState: ReducerState<Out>,
  action: Action<Out, In>,
) => ReducerState<Out>;

function reducer<Out, In>(
  reducerState: ReducerState<Out>,
  action: Action<Out, In>,
): ReducerState<Out> {
  if ("channel" in action && action.channel) {
    // Channel changed
    if (action.channel.value) {
      if (action.channel.value() !== reducerState.value) {
        // Channel changed, synchonous, and the value has changed, update and rerender
        return { value: action.channel.value() };
      }
    } else {
      // Channel changed, asynchronous, mark stale
      return { value: undefined, stale: true };
    }
  } else if ("value" in action) {
    // Async value received
    if (reducerState.stale) {
      // Old value stale, always rerender
      return action;
    } else if (action.value !== reducerState.value) {
      // New value received, update and rerender
      return action;
    }
  }
  return reducerState;
}

export default useChannel;
