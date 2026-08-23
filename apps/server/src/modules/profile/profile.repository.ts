import type Database from "better-sqlite3";
import type { ProfileResponse, ProfileUpdate } from "@workbench/contracts";
import { isUsablePhotoVersion, MAX_USABLE_PHOTO_VERSION, PhotoVersionExhaustedError } from "./photo-version.js";

interface ProfileRow {
  name: string;
  birthday: string;
  employee_number: string;
  photo_blob: Buffer | null;
  photo_mime: string | null;
  photo_version: number;
}

function hasUsablePhoto(photo: Pick<ProfileRow, "photo_blob" | "photo_mime" | "photo_version">): photo is Pick<ProfileRow, "photo_blob" | "photo_mime" | "photo_version"> & { photo_blob: Buffer; photo_mime: "image/jpeg" | "image/png" | "image/webp" } {
  return Buffer.isBuffer(photo.photo_blob) && (photo.photo_mime === "image/jpeg" || photo.photo_mime === "image/png" || photo.photo_mime === "image/webp") && isUsablePhotoVersion(photo.photo_version);
}

export class ProfileRepository {
  public constructor(private readonly database: Database.Database) {}

  public get(): ProfileResponse {
    const profile = this.database.prepare("SELECT name, birthday, employee_number, photo_blob, photo_mime, photo_version FROM profile WHERE id = 1").get() as ProfileRow;
    const customFields = this.database.prepare("SELECT label, value FROM profile_custom_fields WHERE profile_id = 1 ORDER BY position").all() as ProfileResponse["customFields"];
    return { name: profile.name, birthday: profile.birthday, employeeNumber: profile.employee_number, photoVersion: hasUsablePhoto(profile) ? profile.photo_version : null, customFields };
  }

  public update(input: ProfileUpdate): ProfileResponse {
    const save = this.database.transaction((profile: ProfileUpdate) => {
      this.database.prepare("UPDATE profile SET name = ?, birthday = ?, employee_number = ?, updated_at = CURRENT_TIMESTAMP WHERE id = 1").run(profile.name, profile.birthday, profile.employeeNumber);
      this.database.prepare("DELETE FROM profile_custom_fields WHERE profile_id = 1").run();
      const insertCustomField = this.database.prepare("INSERT INTO profile_custom_fields (profile_id, position, label, value) VALUES (1, ?, ?, ?)");
      profile.customFields.forEach((field, position) => insertCustomField.run(position, field.label, field.value));
    });
    save(input);
    return this.get();
  }

  public setPhoto(input: { bytes: Buffer; mimeType: string }): ProfileResponse {
    this.database.transaction((photo: { bytes: Buffer; mimeType: string }) => {
      const current = this.database.prepare("SELECT photo_version FROM profile WHERE id = 1").get() as { photo_version: unknown };
      if (current.photo_version === MAX_USABLE_PHOTO_VERSION) throw new PhotoVersionExhaustedError();
      const nextVersion = isUsablePhotoVersion(current.photo_version) ? current.photo_version + 1 : 1;
      this.database.prepare("UPDATE profile SET photo_blob = ?, photo_mime = ?, photo_version = ?, updated_at = CURRENT_TIMESTAMP WHERE id = 1").run(photo.bytes, photo.mimeType, nextVersion);
    })(input);
    return this.get();
  }

  public getPhoto(): { bytes: Buffer; mimeType: string; version: number } | null {
    const photo = this.database.prepare("SELECT photo_blob, photo_mime, photo_version FROM profile WHERE id = 1").get() as Pick<ProfileRow, "photo_blob" | "photo_mime" | "photo_version">;
    return hasUsablePhoto(photo) ? { bytes: photo.photo_blob, mimeType: photo.photo_mime, version: photo.photo_version } : null;
  }
}
