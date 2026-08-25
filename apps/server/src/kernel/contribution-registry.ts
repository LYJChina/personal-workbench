import {
  PluginContributionSchema,
  PluginIdSchema,
  type PluginContribution
} from "@workbench/contracts";

export const pluginContributionCollisionCode = "PLUGIN_CONTRIBUTION_COLLISION";

export interface RegisteredContribution {
  pluginId: string;
  contribution: PluginContribution;
}

interface InternalContribution extends RegisteredContribution {
  registration: symbol;
}

function identity(contribution: PluginContribution): string {
  return `${contribution.type}:${contribution.id}`;
}

export class ContributionRegistry {
  readonly #entries: InternalContribution[] = [];

  public register(pluginId: string, contributions: PluginContribution[]): () => void {
    const canonicalPluginId = PluginIdSchema.parse(pluginId);
    const parsed = PluginContributionSchema.array().parse(contributions);
    const identities = new Set(this.#entries.map((entry) => identity(entry.contribution)));
    const routePaths = new Set(this.#entries.flatMap((entry) =>
      entry.contribution.type === "route" ? [entry.contribution.path] : []
    ));
    const componentTokens = new Set(this.#entries.flatMap((entry) =>
      "component" in entry.contribution ? [entry.contribution.component] : []
    ));

    for (const contribution of parsed) {
      const contributionIdentity = identity(contribution);
      const routeCollision = contribution.type === "route" && routePaths.has(contribution.path);
      const componentCollision = "component" in contribution && componentTokens.has(contribution.component);
      if (identities.has(contributionIdentity) || routeCollision || componentCollision) {
        throw new Error(pluginContributionCollisionCode);
      }
      identities.add(contributionIdentity);
      if (contribution.type === "route") routePaths.add(contribution.path);
      if ("component" in contribution) componentTokens.add(contribution.component);
    }

    const registration = Symbol(canonicalPluginId);
    this.#entries.push(...parsed.map((contribution) => ({
      registration,
      pluginId: canonicalPluginId,
      contribution
    })));

    return () => {
      for (let index = this.#entries.length - 1; index >= 0; index -= 1) {
        if (this.#entries[index]!.registration === registration) this.#entries.splice(index, 1);
      }
    };
  }

  public list(type?: PluginContribution["type"]): RegisteredContribution[] {
    return this.#entries
      .filter((entry) => type === undefined || entry.contribution.type === type)
      .map((entry) => ({
        pluginId: entry.pluginId,
        contribution: { ...entry.contribution }
      }));
  }
}
