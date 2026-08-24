import { EventEmitter } from "node:events";
import { describe, expect, it, vi } from "vitest";
import { bindRequestLifecycle } from "../src/http/request-lifecycle";

describe("request database lifecycle", () => {
  it.each(["finish", "close"])("closes exactly once when response emits %s", (event) => {
    const request = new EventEmitter();
    Object.assign(request, { aborted: false });
    const response = new EventEmitter();
    Object.assign(response, { destroyed: false });
    const close = vi.fn();

    const signal = bindRequestLifecycle(request as never, response as never, close);
    response.emit(event);
    response.emit(event === "finish" ? "close" : "finish");

    expect(close).toHaveBeenCalledTimes(1);
    expect(signal.aborted).toBe(event === "close");
  });

  it("aborts and closes exactly once on a client-aborted request", () => {
    const request = new EventEmitter();
    Object.assign(request, { aborted: false });
    const response = new EventEmitter();
    Object.assign(response, { destroyed: false });
    const close = vi.fn();

    const signal = bindRequestLifecycle(request as never, response as never, close);
    request.emit("aborted");
    response.emit("close");

    expect(signal.aborted).toBe(true);
    expect(close).toHaveBeenCalledTimes(1);
  });
});
