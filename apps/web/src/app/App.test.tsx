import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import { App } from "./App";

describe("App", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("renders primary navigation and exposes the password vault", async () => {
    vi.stubGlobal("fetch", vi.fn(async (input: string | URL | Request) => {
      if (String(input) === "/api/vault/status") {
        return new Response(JSON.stringify({ configured: true, unlocked: true }), {
          status: 200,
          headers: { "Content-Type": "application/json" }
        });
      }
      return new Response(JSON.stringify([]), { status: 200, headers: { "Content-Type": "application/json" } });
    }));
    render(
      <MemoryRouter>
        <App />
      </MemoryRouter>
    );

    expect(await screen.findByRole("link", { name: "我的主页" })).toBeVisible();
    expect(screen.getByRole("link", { name: "AI 办公" })).toBeVisible();
    expect(screen.getByRole("link", { name: "密码保险箱" })).toHaveAttribute("href", "/password-vault");
  });
});
