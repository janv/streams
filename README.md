# @janv/streams

A lightweight TypeScript library providing reactive primitives for building
event-driven applications. Designed as a minimal abstraction layer for reactive
programming with excellent type safety.

The original goal behind this library was to create a re-usable set of helpers
that can be easily combined with each other to hooking up various kinds of
synchronous or asynchronous data sources to React.

## Installation

```bash
npm install @janv/streams
```

## Core Concepts

### Streams (Sources)

A stream is a simple event emitter function that can be subscribed to:

```typescript
type Source<T> = (handler: (value: T) => void) => () => void;
```

Streams are:
- **Lazy** - nothing happens until a handler subscribes
- **Lightweight** - passing streams around is essentially "free"
- **Composable** - operators transform streams into new streams

Streams make no guarantees about asynchronicity — a handler may be called synchronously or asynchronously depending on the implementation. This is intentionally different from Promises, which always resolve asynchronously. Certain streams _can_ choose to make such guarantees based on their use case, but the concept itself does not require it.

From the perspective of a consumer, it is impossible to distinguish between a direct source (such as returned from `makeSource`) and a source that has been extended with operators.

```typescript
import { makeSource } from '@janv/streams';

const source = makeSource<number>();

// Subscribe to the stream
const unsubscribe = source((value) => {
  console.log('Received:', value);
});

// Emit values
source.emit(1);
source.emit(2, 3, 4);

// Cleanup
unsubscribe();
```

### Channels

Streams are one-directional. Channels extend streams with bidirectional communication: a subscribe method (a stream), an optional update function, and an optional synchronous value getter.

```typescript
interface Channel<Out, In = Out> {
  subscribe: Source<Out>;    // Stream for reading values
  update?: (v: In) => void;  // Method to send values back
  value?: () => Out;         // Synchronous getter for current value
}
```

The `value` getter is provided as a _function_ (not a plain value) so that a channel can be passed around and re-used while always returning an up-to-date current value. It is optional because there are scenarios where a synchronous default makes no sense or cannot be determined. If an initial value can be provided synchronously, the source can simply emit it on the stream once ready.

The `update` function is also optional — there are cases where a read-only channel with a default value is all that's needed. For the common read-write case, `ReadWriteChannel` makes `update` required.

It is not strictly necessary for the input and output types to be identical, though it is common in practice.

```typescript
import { makeValueChannel } from '@janv/streams';

const channel = makeValueChannel(() => 'initial');

// Subscribe to changes
const unsubscribe = channel.subscribe((value) => {
  console.log('New value:', value);
});

// Get current value synchronously
console.log(channel.value()); // 'initial'

// Update the value
channel.update('updated');

unsubscribe();
```

### BufferedChannel

`BufferedChannel` is a stateful `ReadWriteChannel` that synchronizes values between the stream and the update method to provide an optimized synchronous UI experience, even when the underlying source is asynchronous.

Values sent through `update` are immediately emitted back to the stream, _unless_ updating the source causes it to synchronously emit a value (avoiding double-emit). A `BufferedChannel` also supports updater functions in addition to plain values. Because it caches the current value, the input and output types must be identical.

## Operators

Operators transform streams. Use the `pipe` function to compose them:

```typescript
import { pipe, filter, map, memo } from '@janv/streams';

const processed = pipe(
  source,
  filter((n) => n > 0),
  map((n) => n * 2),
  memo() // deduplicate consecutive identical values
);
```

### Available Operators

| Operator | Description |
|----------|-------------|
| `filter(predicate)` | Remove values that don't match the predicate |
| `map(fn)` | Transform values using a mapping function |
| `mapAsync(fn)` | Async map supporting promises; always delivers results asynchronously |
| `startWith(value)` | Guarantee handler invocation with initial value |
| `memo(equals?)` | Deduplicate consecutive identical values |
| `fan` | Efficient fan-out for multiple subscribers (subscribes to source only once) |
| `switchAll` | Flatten nested streams (stream of streams to stream) |
| `merge(...sources)` | Combine multiple sources into one |
| `combineLatest(...sources)` | Combine latest values from multiple sources |
| `tap(onValue?, onSubscribe?, onUnsubscribe?)` | Side effect hooks |
| `effect(afterFirstSubscribe)` | Resource management (runs on first subscription, cleanup on last unsubscribe) |

### switchAll Pattern

A common pattern for working with dynamic stream sources:

```typescript
import { pipe, startWith, map, switchAll } from '@janv/streams';

// Given a stream of objects that each contain a stream
const modeSource = pipe(
  sceneStream,
  startWith(() => getScene()),
  map((scene) => startWith(() => getCurrentMode())(scene.mode)),
  switchAll
);
```

### fan Operator

Use `fan` when multiple handlers need to subscribe to the same processed stream:

```
Without fan:
       +--> Filter --> Map --> Consumer
Source |
       +--> Filter --> Map --> Consumer

With fan:
                               +--> Consumer
Source --> Filter --> Map --> fan
                               +--> Consumer
```

## Channel Types

Different channel interfaces for various use cases:

| Type | `subscribe` | `update` | `value` |
|------|-------------|----------|---------|
| `Channel<Out, In>` | Yes | Optional | Optional |
| `ChannelSync<Out, In>` | Yes | Optional | Required |
| `ReadOnlyChannel<Out>` | Yes | No | Optional |
| `ReadWriteChannel<Out, In>` | Yes | Required | Optional |
| `ReadWriteChannelSync<Out, In>` | Yes | Required | Required |

## API Reference

### Stream Creation

#### `makeSource<T>(onSubscribe?, onUnsubscribe?)`

Create a custom event source:

```typescript
const source = makeSource<number>(
  (emit) => emit(initialValue),  // Called when handler subscribes
  () => console.log('Unsubscribed')
);

source.emit(42);  // Emit to all handlers
source.handlers;  // Set of current handlers
```

### Channel Creation

#### `makeValueChannel<T>(initialValue: () => T)`

Create a simple read-write channel around a single value:

```typescript
const channel = makeValueChannel(() => 0);
channel.value();     // Get current value
channel.update(5);   // Update and emit
```

## TypeScript Support

The library is fully typed with comprehensive generic support:

```typescript
import type {
  Source,
  Handler,
  UnsubscribeFn,
  Operator,
  Channel,
  ChannelSync,
  ReadOnlyChannel,
  ReadWriteChannel,
  ReadWriteChannelSync,
} from '@janv/streams';
```

## React Integration

```bash
import { useStream, useChannel } from '@janv/streams/react';
```

### `useStream`

Subscribes a component to a `Source<T>` and re-renders on each emission. Accepts an optional initial value that is used until the stream emits.

```typescript
// Without initial value — returns T | undefined until first emission
const count = useStream(countSource);

// With initial value — always returns T
const count = useStream(countSource, 0);
const count = useStream(countSource, () => expensiveDefault());
```

### `useChannel`

Subscribes to a `Channel` and returns `[value, update?]`. The hook understands the channel type hierarchy and narrows the return type accordingly:

```typescript
// ReadWriteChannelSync — value and update guaranteed, no default needed
const [value, update] = useChannel(readWriteSyncChannel);

// ReadWriteChannel with explicit default — value and update guaranteed
const [value, update] = useChannel(readWriteChannel, 'default');

// ReadWriteChannel without default — value may be undefined
const [value, update] = useChannel(readWriteChannel);

// ReadOnlyChannelSync — value guaranteed, no update
const [value] = useChannel(readOnlySync);

// ReadOnlyChannel with explicit default — value guaranteed
const [value] = useChannel(readOnlyChannel, 'default');

// Channel may be falsy (null/undefined/false/0/'') — hook suspends
const [value, update] = useChannel(maybeChannel, 'default');
```

**Synchronous channels (`value()` present):** `useChannel` always reads the current value directly from `channel.value()` rather than relying on React state. This avoids stale-value issues even when the channel updates synchronously outside of React's render cycle.

**Channel identity:** the hook re-subscribes whenever the `channel` reference changes, similar to how `useEffect` handles dependencies.

## Development

```bash
# Install dependencies
npm install

# Run tests
npm test

# Build
npm run build
```

## License

MIT
