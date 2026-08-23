export interface SecretStore {
  protectSecret(name: string, plaintext: string): Promise<void>;
  readSecret(name: string): Promise<string | null>;
}
