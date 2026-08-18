import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it } from "vitest";
import { App } from "./App";

describe("App", () => {
  it("renders primary navigation and keeps the password vault unavailable", () => {
    render(
      <MemoryRouter>
        <App />
      </MemoryRouter>
    );

    expect(screen.getByRole("link", { name: "我的主页" })).toBeVisible();
    expect(screen.getByRole("link", { name: "AI 办公" })).toBeVisible();
    expect(screen.getByText("密码保险箱")).toHaveAttribute("aria-disabled", "true");
  });
});
