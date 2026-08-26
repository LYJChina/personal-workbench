import type { SecretStore } from "../../platform/secret-store.js";
import type { AiConnectionRepository } from "./ai-connection.repository.js";
import {
  AiGatewayError,
  type AiCompletionInput,
  type AiCompletionResult,
  type AiProviderAdapter
} from "./ai-gateway.types.js";

interface AiGatewayDependencies {
  repository: Pick<AiConnectionRepository, "get" | "getDefault">;
  secretStore: Pick<SecretStore, "readSecret">;
  openai: AiProviderAdapter;
  anthropic: AiProviderAdapter;
}

export class AiGateway {
  public constructor(private readonly dependencies: AiGatewayDependencies) {}

  public async complete(input: AiCompletionInput): Promise<AiCompletionResult> {
    const connection = this.dependencies.repository.getDefault();
    if (!connection) throw new AiGatewayError("not_configured");
    const apiKey = await this.dependencies.secretStore.readSecret(connection.secretName);
    if (!apiKey) throw new AiGatewayError("not_configured");
    const adapter = connection.protocol === "anthropic" ? this.dependencies.anthropic : this.dependencies.openai;
    return adapter.complete(connection, apiKey, input);
  }

  public async testConnection(id: string, signal?: AbortSignal): Promise<void> {
    const connection = this.dependencies.repository.get(id);
    if (!connection) throw new AiGatewayError("not_configured");
    const apiKey = await this.dependencies.secretStore.readSecret(connection.secretName);
    if (!apiKey) throw new AiGatewayError("not_configured");
    const adapter = connection.protocol === "anthropic" ? this.dependencies.anthropic : this.dependencies.openai;
    await adapter.complete(connection, apiKey, {
      messages: [{ role: "user", content: "Reply only with OK." }],
      temperature: 0,
      maxTokens: 32,
      signal
    });
  }
}
