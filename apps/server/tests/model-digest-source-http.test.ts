import { afterEach, describe, expect, it, vi } from "vitest";
import { ModelSourceError, readSourceJson } from "../src/modules/model-digest/source-http.js";

afterEach(() => vi.unstubAllGlobals());

describe("model digest source transport errors", () => {
  it("keeps a safe underlying network error code for diagnosis", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(
      new TypeError("fetch failed", { cause: Object.assign(new Error("connect failed"), { code: "ECONNRESET" }) })
    ));

    await expect(readSourceJson(new URL("https://huggingface.co/api/models")))
      .rejects.toMatchObject({ category: "network", transportCode: "ECONNRESET" });
  });
});
