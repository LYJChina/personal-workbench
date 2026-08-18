import type Database from "better-sqlite3";
import type { ProfileResponse, ProfileUpdate } from "@workbench/contracts";

interface ProfileRow {
  name: string;
  birthday: string;
  employee_number: string;
  photo_filename: string | null;
}

export class ProfileRepository {
  public constructor(private readonly database: Database.Database) {}

  public get(): ProfileResponse {
    const profile = this.database.prepare("SELECT name, birthday, employee_number, photo_filename FROM profile WHERE id = 1").get() as ProfileRow;
    const customFields = this.database
      .prepare("SELECT label, value FROM profile_custom_fields WHERE profile_id = 1 ORDER BY position")
      .all() as ProfileResponse["customFields"];

    return {
      name: profile.name,
      birthday: profile.birthday,
      employeeNumber: profile.employee_number,
      photoFilename: profile.photo_filename,
      customFields
    };
  }

  public update(input: ProfileUpdate): ProfileResponse {
    const save = this.database.transaction((profile: ProfileUpdate) => {
      this.database
        .prepare("UPDATE profile SET name = ?, birthday = ?, employee_number = ?, updated_at = CURRENT_TIMESTAMP WHERE id = 1")
        .run(profile.name, profile.birthday, profile.employeeNumber);
      this.database.prepare("DELETE FROM profile_custom_fields WHERE profile_id = 1").run();
      const insertCustomField = this.database.prepare(
        "INSERT INTO profile_custom_fields (profile_id, position, label, value) VALUES (1, ?, ?, ?)"
      );
      profile.customFields.forEach((field, position) => insertCustomField.run(position, field.label, field.value));
    });

    save(input);
    return this.get();
  }

  public setPhotoFilename(filename: string): ProfileResponse {
    this.database
      .prepare("UPDATE profile SET photo_filename = ?, updated_at = CURRENT_TIMESTAMP WHERE id = 1")
      .run(filename);
    return this.get();
  }

  public referencesPhoto(filename: string): boolean {
    return Boolean(this.database.prepare("SELECT 1 FROM profile WHERE id = 1 AND photo_filename = ?").get(filename));
  }
}
