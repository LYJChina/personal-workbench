import { afterEach, describe, expect, it, vi } from "vitest";
import { api } from "./api";

describe("backup download client", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    document.body.replaceChildren();
  });

  it("uses a sanitized server filename and releases the temporary browser download resources", async () => {
    const blob = new Blob(["sqlite"]);
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(blob, {
      status: 200,
      headers: { "Content-Disposition": 'attachment; filename="LYJWorkBench-backup-2026-08-23.sqlite"' }
    })));
    const createObjectURL = vi.fn().mockReturnValue("blob:workbench-backup");
    const revokeObjectURL = vi.fn();
    vi.stubGlobal("URL", { ...URL, createObjectURL, revokeObjectURL });
    const click = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => undefined);

    const filename = await api.exportDatabase();

    expect(fetch).toHaveBeenCalledWith("/api/backup/export", { method: "POST" });
    expect(filename).toBe("LYJWorkBench-backup-2026-08-23.sqlite");
    expect(createObjectURL).toHaveBeenCalledTimes(1);
    expect(createObjectURL.mock.calls[0]?.[0]).toEqual(expect.objectContaining({ size: expect.any(Number) }));
    expect(click).toHaveBeenCalledTimes(1);
    expect(document.querySelector("a")).toBeNull();
    expect(revokeObjectURL).toHaveBeenCalledWith("blob:workbench-backup");
  });

  it("falls back from an unsafe filename and still revokes the URL when clicking fails", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(new Blob(["sqlite"]), {
      status: 200,
      headers: { "Content-Disposition": 'attachment; filename="..\\secrets.txt"' }
    })));
    vi.stubGlobal("URL", {
      ...URL,
      createObjectURL: vi.fn().mockReturnValue("blob:failing-download"),
      revokeObjectURL: vi.fn()
    });
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (this: HTMLAnchorElement) {
      expect(this.download).toBe("LYJWorkBench-backup.sqlite");
      throw new Error("click failed");
    });

    await expect(api.exportDatabase()).rejects.toThrow("click failed");

    expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:failing-download");
    expect(document.querySelector("a")).toBeNull();
  });

  it("does not create an object URL for a sanitized HTTP failure", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({
      error: { message: "导出失败，请稍后重试" }
    }), { status: 500, headers: { "Content-Type": "application/json" } })));
    const createObjectURL = vi.fn();
    vi.stubGlobal("URL", { ...URL, createObjectURL, revokeObjectURL: vi.fn() });

    await expect(api.exportDatabase()).rejects.toThrow("导出失败，请稍后重试");
    expect(createObjectURL).not.toHaveBeenCalled();
  });
});
