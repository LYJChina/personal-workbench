import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AppearanceProvider, useAppearance } from "./AppearanceProvider";

function Probe() {
  const { appearance, persistenceError, retryAppearance, updateAppearance } = useAppearance();
  return <><span>{JSON.stringify(appearance)}</span><span>{persistenceError ? "save-error" : "saved"}</span>
    <button onClick={() => updateAppearance({ skin: "sage" })}>sage</button>
    <button onClick={() => updateAppearance({ density: "compact" })}>compact</button>
    <button onClick={retryAppearance}>retry</button></>;
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}

describe("appearance database migration", () => {
  afterEach(() => {
    localStorage.clear();
    vi.restoreAllMocks();
  });

  it("imports one valid legacy value only after the server confirms it", async () => {
    const legacy = { skin: "paper", density: "compact", radius: "subtle", glass: false } as const;
    localStorage.setItem("workbench.appearance.v1", JSON.stringify(legacy));
    const api = {
      getAppearance: vi.fn().mockResolvedValue({ appearance: null }),
      updateAppearance: vi.fn().mockResolvedValue(legacy)
    };

    render(<AppearanceProvider api={api}><Probe /></AppearanceProvider>);

    expect(screen.getByText(/"skin":"aurora"/)).toBeInTheDocument();
    await waitFor(() => expect(screen.getByText(/"skin":"paper"/)).toBeInTheDocument());
    expect(api.updateAppearance).toHaveBeenCalledWith(legacy);
    expect(localStorage.getItem("workbench.appearance.v1")).toBeNull();
  });

  it("retries the failed legacy target, clears its key, and makes it authoritative after confirmation", async () => {
    const legacy = { skin: "paper", density: "compact", radius: "subtle", glass: false } as const;
    localStorage.setItem("workbench.appearance.v1", JSON.stringify(legacy));
    const api = {
      getAppearance: vi.fn().mockResolvedValue({ appearance: null }),
      updateAppearance: vi.fn().mockRejectedValueOnce(new Error("offline")).mockResolvedValueOnce(legacy)
    };

    render(<AppearanceProvider api={api}><Probe /></AppearanceProvider>);

    await waitFor(() => expect(api.updateAppearance).toHaveBeenCalled());
    expect(screen.getByText(/"skin":"aurora"/)).toBeInTheDocument();
    expect(localStorage.getItem("workbench.appearance.v1")).toBe(JSON.stringify(legacy));
    expect(screen.getByText("save-error")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "retry" }));
    await waitFor(() => expect(screen.getByText(/"skin":"paper"/)).toBeInTheDocument());
    expect(api.updateAppearance).toHaveBeenLastCalledWith(legacy);
    expect(localStorage.getItem("workbench.appearance.v1")).toBeNull();
  });

  it("discards a failed legacy retry target when a newer user change succeeds", async () => {
    const legacy = { skin: "paper", density: "compact", radius: "subtle", glass: false } as const;
    localStorage.setItem("workbench.appearance.v1", JSON.stringify(legacy));
    const api = {
      getAppearance: vi.fn().mockResolvedValue({ appearance: null }),
      updateAppearance: vi.fn().mockRejectedValueOnce(new Error("offline")).mockImplementation(async (value) => value)
    };
    render(<AppearanceProvider api={api}><Probe /></AppearanceProvider>);
    await screen.findByText("save-error");
    fireEvent.click(screen.getByRole("button", { name: "sage" }));
    await waitFor(() => expect(screen.getByText("saved")).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: "retry" }));
    await Promise.resolve();
    expect(api.updateAppearance).toHaveBeenCalledTimes(2);
    expect(api.updateAppearance).toHaveBeenLastCalledWith({ skin: "sage", density: "comfortable", radius: "rounded", glass: true });
    expect(screen.getByText(/"skin":"sage"/)).toBeInTheDocument();
  });

  it("treats the database value as authoritative over stale local storage", async () => {
    localStorage.setItem("workbench.appearance.v1", JSON.stringify({ skin: "paper", density: "compact", radius: "subtle", glass: false }));
    const stored = { skin: "sage", density: "comfortable", radius: "rounded", glass: true } as const;
    const api = { getAppearance: vi.fn().mockResolvedValue({ appearance: stored }), updateAppearance: vi.fn() };

    render(<AppearanceProvider api={api}><Probe /></AppearanceProvider>);

    await waitFor(() => expect(screen.getByText(/"skin":"sage"/)).toBeInTheDocument());
    expect(api.updateAppearance).not.toHaveBeenCalled();
    expect(localStorage.getItem("workbench.appearance.v1")).toBeNull();
  });

  it("does not let a late bootstrap overwrite an immediate user choice", async () => {
    const bootstrap = deferred<{ appearance: null }>();
    const api = { getAppearance: vi.fn(() => bootstrap.promise), updateAppearance: vi.fn(async (value) => value) };
    render(<AppearanceProvider api={api}><Probe /></AppearanceProvider>);
    fireEvent.click(screen.getByRole("button", { name: "sage" }));
    bootstrap.resolve({ appearance: null });
    await waitFor(() => expect(screen.getByText(/"skin":"sage"/)).toBeInTheDocument());
    await waitFor(() => expect(api.updateAppearance).toHaveBeenCalledTimes(1));
  });

  it("serializes rapid writes and exposes a retry after failure", async () => {
    const first = deferred<never>();
    const api = {
      getAppearance: vi.fn().mockResolvedValue({ appearance: null }),
      updateAppearance: vi.fn()
        .mockImplementationOnce(() => first.promise)
        .mockRejectedValueOnce(new Error("offline"))
        .mockImplementation(async (value) => value)
    };
    render(<AppearanceProvider api={api}><Probe /></AppearanceProvider>);
    fireEvent.click(screen.getByRole("button", { name: "sage" }));
    fireEvent.click(screen.getByRole("button", { name: "compact" }));
    await waitFor(() => expect(api.updateAppearance).toHaveBeenCalledTimes(1));
    first.resolve(undefined as never);
    await waitFor(() => expect(screen.getByText("save-error")).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: "retry" }));
    await waitFor(() => expect(screen.getByText("saved")).toBeInTheDocument());
    expect(api.updateAppearance).toHaveBeenLastCalledWith({ skin: "sage", density: "compact", radius: "rounded", glass: true });
  });
});
