import { useEffect, useState } from "react";
import type { Source } from "../index.js";

function useStream<T>(stream: Source<T>, initialValue: T | (() => T)): T;
function useStream<T>(
  stream: Source<T>,
  initialValue?: T | (() => T),
): T | undefined;
function useStream<T>(
  stream: Source<T>,
  initialValue?: T | (() => T),
): T | undefined {
  const [state, setState] = useState(initialValue);

  useEffect(() => {
    return stream((e) => {
      setState(e);
    });
  }, [stream]);

  return state;
}

export default useStream;
