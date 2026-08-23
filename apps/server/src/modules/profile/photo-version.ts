export const MAX_USABLE_PHOTO_VERSION = Number.MAX_SAFE_INTEGER - 1;
export const MAX_INCREMENTABLE_PHOTO_VERSION = MAX_USABLE_PHOTO_VERSION - 1;

export class PhotoVersionExhaustedError extends Error {
  public constructor() {
    super("Profile photo version is exhausted");
    this.name = "PhotoVersionExhaustedError";
  }
}

export function isUsablePhotoVersion(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0 && value <= MAX_USABLE_PHOTO_VERSION;
}
