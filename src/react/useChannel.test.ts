import { act, renderHook } from "@testing-library/react";
import { useEffect } from "react";
import {
  type Channel,
  type ReadWriteChannel,
  type ReadWriteChannelSync,
} from "../Channel.js";
import useChannel from "./useChannel.js";
import { makeSource } from "../index.js";
import { vi, describe, test, expect, beforeEach, type Mock } from "vitest";

function makeTestChannel(initial = ""): ReadWriteChannelSync<string> {
  let v: string = initial;
  const subscribe = makeSource<string>();
  const update = (n: string) => {
    v = n;
    subscribe.emit(n);
  };
  const value = () => v;
  return {
    subscribe,
    update,
    value,
  };
}

function renderUseChannelHook(
  oldChannel?: Channel<string>,
  oldDefaultValue?: string,
) {
  // Used to observe what value are visible during render, and how often was rendered
  const renderMock = vi.fn().mockName("renderMock");
  const renderResult = renderHook(
    ({ channel, defaultValue }) => {
      const result = useChannel(channel, defaultValue);
      renderMock(result[0]);
      return result;
    },
    {
      initialProps: { channel: oldChannel, defaultValue: oldDefaultValue },
    },
  );
  const rerender = (newChannel?: Channel<string>, newDefaultValue?: string) => {
    renderMock.mockReset();
    renderResult.rerender({
      channel: newChannel,
      defaultValue: newDefaultValue,
    });
  };
  return {
    currentValue: () => renderResult.result.current[0],
    rerender,
    renderMock,
  };
}

describe("useChannel initial values", () => {
  const oldChannel = makeTestChannel("old");

  let currentValue: () => string | undefined;
  let rerender: (c?: Channel<string>, i?: string) => void;
  let renderMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    ({ currentValue, rerender, renderMock } = renderUseChannelHook(
      oldChannel,
      "oldDefaultValue",
    ));
    expect(currentValue()).toBe("old");
    expect(renderMock).not.toBeCalledWith("oldDefaultValue");
  });

  describe("initial state", () => {
    test("should use defaultValue when channel undefined", () => {
      ({ currentValue, rerender, renderMock } = renderUseChannelHook(
        undefined,
        "fallback1",
      ));
      expect(currentValue()).toBe("fallback1");
      rerender(oldChannel, "fallback2");
      expect(currentValue()).toBe("old");
      expect(renderMock).not.toBeCalledWith("fallback1");
      expect(renderMock).not.toBeCalledWith("fallback2");
    });

    test("should switch to defaultValue when channel is removed", () => {
      ({ currentValue, rerender, renderMock } = renderUseChannelHook(
        oldChannel,
        "fallback1",
      ));
      expect(currentValue()).toBe("old");
      rerender(undefined, "fallback2");
      expect(currentValue()).toBe("fallback2");
      expect(renderMock).not.toBeCalledWith("fallback1");
      expect(renderMock).not.toBeCalledWith("old");
    });
  });

  describe("adding a sync channel", () => {
    const newChannel = makeTestChannel("new");
    test("should return the value", () => {
      rerender(newChannel);
      expect(currentValue()).toBe("new");
      expect(renderMock).not.toBeCalledWith("oldDefaultValue");
      expect(renderMock).not.toBeCalledWith("old");
    });
  });

  describe("adding an async channel", () => {
    const newChannel: ReadWriteChannel<string> = makeTestChannel("new");
    delete newChannel.value;

    test("should return the defaultValue", () => {
      rerender(newChannel, "newDefaultValue");
      expect(currentValue()).toBe("newDefaultValue");
      expect(renderMock).not.toBeCalledWith("oldDefaultValue");
      expect(renderMock).not.toBeCalledWith("old");
    });

    test("should return undefined when defaultValue is missing", () => {
      rerender(newChannel);
      expect(currentValue()).toBe(undefined);
      expect(renderMock).not.toBeCalledWith("oldDefaultValue");
      expect(renderMock).not.toBeCalledWith("old");
    });
  });

  describe("removing the channel", () => {
    test("should return the defaultValue", () => {
      rerender(undefined, "newDefaultValue");
      expect(currentValue()).toBe("newDefaultValue");
      expect(renderMock).not.toBeCalledWith(undefined);
      expect(renderMock).not.toBeCalledWith("oldDefaultValue");
      expect(renderMock).not.toBeCalledWith("old");
      // Return value should stay undefined
      rerender(undefined, "newDefaultValue");
      expect(currentValue()).toBe("newDefaultValue");
    });

    test("should return undefined when defaultValue is missing", () => {
      rerender(undefined);
      expect(currentValue()).toBe(undefined);
      expect(renderMock).not.toBeCalledWith("oldDefaultValue");
      expect(renderMock).not.toBeCalledWith("old");
    });
  });
});

describe("missing channel", () => {
  test("should always return the current defaultValue", () => {
    const { currentValue, rerender, renderMock } = renderUseChannelHook(
      undefined,
      "oldDefaultValue",
    );
    expect(currentValue()).toBe("oldDefaultValue");
    rerender(undefined, "newDefaultValue");
    expect(renderMock).not.toBeCalledWith("oldDefaultValue");
    expect(currentValue()).toBe("newDefaultValue");
  });

  test("all falsy values count as missing channel", () => {
    [undefined, null, 0, "", false].forEach((channel, i) => {
      const { currentValue } = renderUseChannelHook(channel as any, `init${i}`);
      expect(currentValue()).toBe(`init${i}`);
    });
    expect.assertions(5);
  });
});

describe("useChannel sync channel subscriptions", () => {
  test("changing value between render and effect should not be missed", () => {
    let value = "a";
    const events: string[] = [];
    const source = makeSource<string>();
    const channel: ReadWriteChannelSync<string> = {
      subscribe: (handler) => {
        events.push("subscribe");
        return source(handler);
      },
      value: () => value,
      update: (v: string) => {
        value = v;
        source.emit(v);
      },
    };

    const { result } = renderHook(() => {
      // This effect runs before the subscription effect
      useEffect(() => {
        // Change the value in the channel before subscribing
        events.push("update b");
        channel.update("b");
      }, []);

      const [v] = useChannel(channel);

      events.push(`render ${v}`);

      return v;
    });

    expect(events).toEqual(["render a", "update b", "subscribe", "render b"]);
    expect(result.current).toBe("b");
  });
});

describe("useChannel async channel subscriptions", () => {
  const channel: ReadWriteChannel<string> = makeTestChannel("old");
  delete channel.value;

  let currentValue: () => string | undefined;
  let renderMock: Mock;

  beforeEach(() => {
    ({ currentValue, renderMock } = renderUseChannelHook(
      channel,
      "oldDefaultValue",
    ));
  });

  test("should start with the defaultValue", () => {
    expect(currentValue()).toBe("oldDefaultValue");
  });

  test("should rerender with the new value on event", () => {
    renderMock.mockReset();
    act(() => {
      channel.update("new");
    });
    expect(currentValue()).toBe("new");
    expect(renderMock).not.toBeCalledWith("old");
    expect(renderMock).not.toBeCalledWith("oldDefaultValue");
  });
});

describe("stale state", () => {
  test("should not prevent re-renders", () => {
    const channel = makeTestChannel("one");

    const { renderMock, rerender } = renderUseChannelHook(channel, "default");
    expect(renderMock).toBeCalledWith("one");

    // useChannel subscribed to the channel,
    // channel update should trigger re-render with the new value
    act(() => {
      channel.update("two");
    });
    expect(renderMock).toBeCalledWith("two");
    // At this point the state value in useChannel is `two`

    // Disconnect useChannel, should return the default value
    rerender(undefined, "default2");
    expect(renderMock).toBeCalledWith("default2");

    // We're still disconnected, update the channel
    channel.update("missedUpdate");
    // Resubscribe to the channel
    rerender(channel);
    // The `missedUpdate` should be returned by the value()
    expect(renderMock).toBeCalledWith("missedUpdate");

    // Updating the channel with the value in the hook's state
    // should trigger a re-render
    renderMock.mockClear();
    act(() => {
      channel.update("two");
    });
    expect(renderMock).toBeCalledWith("two");
  });
});
