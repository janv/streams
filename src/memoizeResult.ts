/**
 * Memoize a function result using an equality function.
 *
 * If two invocations of the function result in equal values, the second
 * invocation will return the value of the first invocation instead.
 *
 * @param fn - the function to memoize
 * @param equals - the equality function. If this is missing, the original
 *                 function will be returned, making memoizeResult a no-op
 */
export default function memoizeResult<T, A extends any[]>(
  fn: (...args: A) => T,
  equals?: (value: T, lastValue: T | undefined) => boolean
): (...args: A) => T {
  // If there is no equals comparison, we'd fall back to === equality,
  // in which case the whole memoization is pointless.
  if (!equals) return fn;

  let memoizedValue: T;

  return (...args) => {
    const value = fn(...args);
    if (!equals(value, memoizedValue)) {
      memoizedValue = value;
    }
    return memoizedValue;
  };
}
