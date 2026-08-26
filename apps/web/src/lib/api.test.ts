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

    expect(fetch).toHaveBeenCalledWith("/api/backup/export", {
      method: "POST",
      headers: { "X-LYJ-Workbench-Request": "local-browser-v1" }
    });
    expect(filename).toBe("LYJWorkBench-backup-2026-08-23.sqlite");
    expect(createObjectURL).toHaveBeenCalledTimes(1);
    expect(createObjectURL.mock.calls[0]?.[0]).toEqual(expect.objectContaining({ size: expect.any(Number) }));
    expect(click).toHaveBeenCalledTimes(1);
    expect(document.querySelector("a")).toBeNull();
    expect(revokeObjectURL).toHaveBeenCalledWith("blob:workbench-backup");
  });

  it("adds the fixed local-workbench header to every mutation helper", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ theme: "dark" }), {
      status: 200,
      headers: { "Content-Type": "application/json" }
    }));
    vi.stubGlobal("fetch", fetchMock);

    await api.updateTheme("dark");

    expect(fetchMock).toHaveBeenCalledWith("/api/preferences/theme", expect.objectContaining({
      method: "PUT",
      headers: expect.objectContaining({ "X-LYJ-Workbench-Request": "local-browser-v1" })
    }));
  });

  it("calls every AI connection management endpoint without exposing local secret names", async () => {
    const connection = {
      id: "claude-main",
      name: "Claude",
      protocol: "anthropic" as const,
      baseUrl: "https://api.anthropic.com/v1",
      model: "claude-sonnet",
      apiKeyConfigured: true,
      isDefault: false
    };
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify([connection]), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify(connection), { status: 201 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ ...connection, model: "claude-opus" }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ ...connection, isDefault: true }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ status: "success", message: "连接成功" }), { status: 200 }))
      .mockResolvedValueOnce(new Response(null, { status: 204 }));
    vi.stubGlobal("fetch", fetchMock);
    const controller = new AbortController();

    await api.getAiConnections(controller.signal);
    await api.createAiConnection({
      name: connection.name,
      protocol: connection.protocol,
      baseUrl: connection.baseUrl,
      model: connection.model,
      apiKey: "new-key"
    }, controller.signal);
    await api.updateAiConnection(connection.id, {
      name: connection.name,
      protocol: connection.protocol,
      baseUrl: connection.baseUrl,
      model: "claude-opus"
    }, controller.signal);
    await api.setDefaultAiConnection(connection.id, controller.signal);
    await api.testAiConnection(connection.id, controller.signal);
    await api.deleteAiConnection(connection.id, controller.signal);

    expect(fetchMock).toHaveBeenNthCalledWith(1, "/api/settings/ai-connections", { signal: controller.signal });
    expect(fetchMock).toHaveBeenNthCalledWith(2, "/api/settings/ai-connections", expect.objectContaining({ method: "POST", signal: controller.signal }));
    expect(fetchMock).toHaveBeenNthCalledWith(3, "/api/settings/ai-connections/claude-main", expect.objectContaining({ method: "PUT", signal: controller.signal }));
    expect(fetchMock).toHaveBeenNthCalledWith(4, "/api/settings/ai-connections/claude-main/default", expect.objectContaining({ method: "PUT", signal: controller.signal }));
    expect(fetchMock).toHaveBeenNthCalledWith(5, "/api/settings/ai-connections/claude-main/test", expect.objectContaining({ method: "POST", signal: controller.signal }));
    expect(fetchMock).toHaveBeenNthCalledWith(6, "/api/settings/ai-connections/claude-main", expect.objectContaining({ method: "DELETE", signal: controller.signal }));
    expect(JSON.stringify(fetchMock.mock.calls)).not.toContain("secretName");
  });

  it("calls the plugin management endpoints with abort signals and mutation provenance", async () => {
    const plugin = {
      manifest: {
        manifestVersion: 1,
        id: "lyj.system.ai-chat",
        name: "大模型对话",
        version: "1.0.0",
        author: "LYJ Workbench",
        kind: "system",
        platforms: ["win32", "darwin"],
        permissions: ["ai:use"],
        contributions: []
      },
      enabled: true,
      required: false,
      runtimeStatus: "running",
      permissionsGranted: ["ai:use"],
      errorCode: null
    };
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify([plugin]), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ ...plugin, enabled: false }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify([plugin]), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    const controller = new AbortController();

    await api.getPlugins(controller.signal);
    await api.setPluginEnabled("lyj.system.ai-chat", false, controller.signal);
    await api.resetPluginSafeMode(controller.signal);

    expect(fetchMock).toHaveBeenNthCalledWith(1, "/api/plugins", { signal: controller.signal });
    expect(fetchMock).toHaveBeenNthCalledWith(2, "/api/plugins/lyj.system.ai-chat/enabled", {
      method: "PUT",
      headers: { "Content-Type": "application/json", "X-LYJ-Workbench-Request": "local-browser-v1" },
      body: JSON.stringify({ enabled: false }),
      signal: controller.signal
    });
    expect(fetchMock).toHaveBeenNthCalledWith(3, "/api/plugins/safe-mode/reset", {
      method: "POST",
      headers: { "X-LYJ-Workbench-Request": "local-browser-v1" },
      signal: controller.signal
    });
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
