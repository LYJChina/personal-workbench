export interface SecretStore {
  protectSecret(name: string, plaintext: string): Promise<void>;
  readSecret(name: string): Promise<string | null>;
  deleteSecret(name: string): Promise<void>;
}
