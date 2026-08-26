export class VaultLockedError extends Error {
  public constructor() { super("Vault is locked"); this.name = "VaultLockedError"; }
}

export class InvalidMasterPasswordError extends Error {
  public constructor() { super("Invalid master password"); this.name = "InvalidMasterPasswordError"; }
}

export class VaultIntegrityError extends Error {
  public constructor(message = "Vault secret failed integrity verification") {
    super(message);
    this.name = "VaultIntegrityError";
  }
}

export class VaultMetadataIntegrityError extends VaultIntegrityError {
  public constructor() {
    super("Vault metadata failed integrity verification");
    this.name = "VaultMetadataIntegrityError";
  }
}

export class InvalidRecoveryMaterialError extends Error {
  public constructor() {
    super("Invalid recovery material");
    this.name = "InvalidRecoveryMaterialError";
  }
}
