import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import request from "supertest";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createApp } from "../src/app";

const pngSignature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

describe("personal profile API", () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "lyj-workbench-profile-"));
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  it("persists profile fields and custom fields across app instances", async () => {
    const app = createApp({ dataDir: tempDir });
    const saved = await request(app).put("/api/profile").send({
      name: "李雨佳",
      birthday: "1995-06-18",
      employeeNumber: "LYJ-001",
      customFields: [{ label: "部门", value: "运营部" }]
    });

    expect(saved.status).toBe(200);

    const loaded = await request(createApp({ dataDir: tempDir })).get("/api/profile");
    expect(loaded.body.employeeNumber).toBe("LYJ-001");
    expect(loaded.body.customFields).toEqual([{ label: "部门", value: "运营部" }]);
  });

  it("rejects invalid profile input", async () => {
    const response = await request(createApp({ dataDir: tempDir })).put("/api/profile").send({
      name: "",
      birthday: "not-a-date",
      employeeNumber: "LYJ-001",
      customFields: []
    });

    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe("VALIDATION_ERROR");
  });

  it("rejects a non-image profile upload even when supplied as a file", async () => {
    const response = await request(createApp({ dataDir: tempDir }))
      .post("/api/profile/photo")
      .attach("photo", Buffer.from("not an image"), { filename: "photo.txt", contentType: "text/plain" });

    expect(response.status).toBe(415);
  });

  it("accepts an image with a real PNG signature and serves it only through its generated filename", async () => {
    const upload = await request(createApp({ dataDir: tempDir }))
      .post("/api/profile/photo")
      .attach("photo", pngSignature, { filename: "portrait.png", contentType: "image/png" });

    expect(upload.status).toBe(200);
    expect(upload.body.photoFilename).toMatch(/^[a-f0-9-]+\.png$/);

    const read = await request(createApp({ dataDir: tempDir })).get(`/api/profile/photo/${upload.body.photoFilename}`);
    expect(read.status).toBe(200);
    expect(Buffer.from(read.body)).toEqual(pngSignature);
  });

  it("accepts JPEG, PNG, and WebP signatures regardless of the client-provided filename", async () => {
    const images = [
      { bytes: Buffer.from([0xff, 0xd8, 0xff, 0x00]), extension: "jpg" },
      { bytes: pngSignature, extension: "png" },
      { bytes: Buffer.from("RIFF\x04\x00\x00\x00WEBP", "binary"), extension: "webp" }
    ];

    for (const image of images) {
      const response = await request(createApp({ dataDir: tempDir }))
        .post("/api/profile/photo")
        .attach("photo", image.bytes, { filename: "untrusted.txt", contentType: "text/plain" });

      expect(response.status).toBe(200);
      expect(response.body.photoFilename).toMatch(new RegExp(`^[a-f0-9-]+\\.${image.extension}$`));
    }
  });

  it("accepts an image at the 5 MB boundary and rejects one byte over", async () => {
    const maximumImage = Buffer.concat([pngSignature, Buffer.alloc(5 * 1024 * 1024 - pngSignature.length)]);
    const tooLargeImage = Buffer.concat([pngSignature, Buffer.alloc(5 * 1024 * 1024 + 1 - pngSignature.length)]);
    const app = createApp({ dataDir: tempDir });

    const accepted = await request(app)
      .post("/api/profile/photo")
      .attach("photo", maximumImage, { filename: "maximum.png", contentType: "image/png" });
    const rejected = await request(app)
      .post("/api/profile/photo")
      .attach("photo", tooLargeImage, { filename: "too-large.png", contentType: "image/png" });

    expect(accepted.status).toBe(200);
    expect(rejected.status).toBe(413);
  });

  it("does not serve traversal paths or unreferenced filenames", async () => {
    const app = createApp({ dataDir: tempDir });

    expect((await request(app).get("/api/profile/photo/..%2Fprofile.sqlite")).status).toBe(404);
    expect((await request(app).get("/api/profile/photo/not-referenced.png")).status).toBe(404);
  });
});
