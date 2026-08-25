import type { PluginContribution } from "@workbench/contracts";
import { describe, expect, it } from "vitest";
import { ContributionRegistry } from "../src/kernel/contribution-registry";

const navigation = (id: string): PluginContribution => ({
  type: "navigation",
  id,
  label: id,
  path: `/${id}`,
  icon: "circle",
  position: 1
});

const route = (id: string, path = `/${id}`, component = `system.${id}.page`): PluginContribution => ({
  type: "route",
  id,
  path,
  component
});

describe("ContributionRegistry", () => {
  it.each([
    ["type/id", route("existing"), route("existing", "/other", "system.other.page")],
    ["route path", route("existing"), route("other", "/existing", "system.other.page")],
    ["component token", route("existing"), route("other", "/other", "system.existing.page")]
  ])("validates every global %s collision before mutating", (_label, existing, conflicting) => {
    const registry = new ContributionRegistry();
    registry.register("lyj.system.existing", [existing]);

    expect(() => registry.register("lyj.system.other", [navigation("temporary"), conflicting]))
      .toThrow("PLUGIN_CONTRIBUTION_COLLISION");
    expect(registry.list()).toEqual([{ pluginId: "lyj.system.existing", contribution: existing }]);
  });

  it("revokes only its own entries, repeatedly, while preserving deterministic registration order", () => {
    const registry = new ContributionRegistry();
    const first = navigation("first");
    const second = route("second");
    const third = navigation("third");
    const revokeFirstPlugin = registry.register("lyj.system.first", [first, second]);
    registry.register("lyj.system.second", [third]);

    expect(registry.list()).toEqual([
      { pluginId: "lyj.system.first", contribution: first },
      { pluginId: "lyj.system.first", contribution: second },
      { pluginId: "lyj.system.second", contribution: third }
    ]);

    revokeFirstPlugin();
    revokeFirstPlugin();
    expect(registry.list()).toEqual([{ pluginId: "lyj.system.second", contribution: third }]);
  });

  it("returns defensive copies rather than mutable registry entries", () => {
    const registry = new ContributionRegistry();
    registry.register("lyj.system.first", [navigation("first")]);

    const listed = registry.list("navigation");
    (listed[0]!.contribution as { label: string }).label = "mutated";
    listed.push({ pluginId: "lyj.system.fake", contribution: navigation("fake") });

    expect(registry.list("navigation")).toEqual([
      { pluginId: "lyj.system.first", contribution: navigation("first") }
    ]);
  });
});
