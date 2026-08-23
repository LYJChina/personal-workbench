import { EventEmitter } from "node:events";
import { describe, expect, it, vi } from "vitest";
import { attachParentDisconnect } from "../src/parent-liveness";

class FakeParent extends EventEmitter {
  public connected = true;
  public exit = vi.fn();
}

describe("server parent liveness", () => {
  it("closes the production server and active connections on IPC disconnect", () => {
    const parent = new FakeParent();
    const server = {
      close: vi.fn((callback: (error?: Error) => void) => callback()),
      closeAllConnections: vi.fn()
    };

    attachParentDisconnect(server, parent, true);
    parent.emit("disconnect");

    expect(server.close).toHaveBeenCalledTimes(1);
    expect(server.closeAllConnections).toHaveBeenCalledTimes(1);
    expect(parent.exit).toHaveBeenCalledWith(0);
  });

  it("does nothing in ordinary dev mode without an IPC parent", () => {
    const parent = new FakeParent();
    parent.connected = false;
    const server = { close: vi.fn(), closeAllConnections: vi.fn() };

    attachParentDisconnect(server, parent, false);
    parent.emit("disconnect");

    expect(server.close).not.toHaveBeenCalled();
    expect(server.closeAllConnections).not.toHaveBeenCalled();
    expect(parent.exit).not.toHaveBeenCalled();
  });

  it("fails closed when launcher IPC was expected but disconnected before listener registration", () => {
    const parent = new FakeParent();
    parent.connected = false;
    const server = {
      close: vi.fn((callback: (error?: Error) => void) => callback()),
      closeAllConnections: vi.fn()
    };

    attachParentDisconnect(server, parent, true);

    expect(server.close).toHaveBeenCalledTimes(1);
    expect(server.closeAllConnections).toHaveBeenCalledTimes(1);
    expect(parent.exit).toHaveBeenCalledWith(1);
    expect(parent.listenerCount("disconnect")).toBe(0);
  });
});
