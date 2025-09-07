import type { Handler } from "./streams.js";
import type { Channel } from "./Channel.js";

const identityMap = new WeakMap<Channel<any>, Map<string, Channel<any>>>();

/** @internal */
export type DebugChannel<C> = C & {
  _subscribers: Set<Handler<C extends Channel<infer O> ? O : unknown>>;
  _id: string;
  _debugName: string;
};

export default debugChannel;

/**
 * @internal
 * Wrap a channel with in this method ro receive a channel that logs everything
 * going on inside and provides a list of subscribers and a unique id to tell
 * different instances apart from each other.
 *
 * ```ts
 * const channelWithDebug = debugChannel(channel, 'my channel');
 * ```
 *
 * Since debugChannel has its own identity map, passing in the same channel with
 * the same debug name will always return the same debug channel.
 *
 * @param channel - The channel to debug. Can be undefined/null and will return
 *                  the unchanged `channel` value in that case.
 * @param debugName - If this is undefined/missing, the original channel will be
 *                    returned without modification.
 */
function debugChannel<T extends Channel<any>>(channel: T): T;
function debugChannel<T extends Channel<any>>(
  channel: T,
  debugName: string,
): DebugChannel<T>;
function debugChannel<T extends Channel<any> | null | undefined>(
  channel: T,
  debugName?: string | null | undefined,
): T | DebugChannel<T>;
function debugChannel<T extends Channel<any>>(
  channel: T,
  debugName?: string | null,
) {
  if (debugName == null || !channel) return channel;

  if (!identityMap.has(channel)) {
    identityMap.set(channel, new Map());
  }
  const debugChannelsByName = identityMap.get(channel)!;

  if (!debugChannelsByName.has(debugName)) {
    type Out = T extends Channel<infer O> ? O : never;
    /* eslint-disable no-console */
    const handlers = new Set<Handler<Out>>();
    // @ts-ignore
    const channelWithDebug: DebugChannel<T> = {
      _subscribers: handlers,
      _id: crypto.randomUUID(),
      _debugName: debugName,
      subscribe: (handler) => {
        console.log(`debugChannel ${debugName}: subscribing %O`, handler);
        handlers.add(handler);

        const unsubscribe = channel.subscribe((v) => {
          console.group(
            `debugChannel ${debugName}: receiving %O on handler %O`,
            v,
            handler,
          );
          handler(v);
          console.groupEnd();
        });

        return () => {
          console.log(`debugChannel ${debugName}: unsubscribing %O`, handler);
          handlers.delete(handler);
          unsubscribe();
        };
      },
      value: channel.value
        ? () => {
            const v = channel.value!();
            console.log(`debugChannel ${debugName}: reading value %O`, v);
            return v;
          }
        : undefined,
      update: channel.update
        ? (v) => {
            console.group(`debugChannel ${debugName}: updating value %O`, v);
            channel.update!(v);
            console.groupEnd();
          }
        : undefined,
    };

    debugChannelsByName.set(debugName, channelWithDebug);
  }

  return debugChannelsByName.get(debugName)!;

  /* eslint-enable no-console */
}

export function isDebugChannel<T>(
  channel: Channel<T> | unknown,
): channel is DebugChannel<T> {
  return (
    typeof channel === "object" && channel !== null && "_debugName" in channel
  );
}
