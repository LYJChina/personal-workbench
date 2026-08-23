import { mkdtemp, readdir, rm } from "node:fs/promises";
import { createServer } from "node:http";
import { connect } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import request from "supertest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createApp } from "../src/app";
import { resolveAppPaths } from "../src/config/paths";
import { openDatabase } from "../src/db/database";

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

  it("stores an uploaded PNG in SQLite and serves it from the fixed endpoint after the uploads directory is removed", async () => {
    const upload = await request(createApp({ dataDir: tempDir }))
      .post("/api/profile/photo")
      .attach("photo", pngSignature, { filename: "portrait.png", contentType: "image/png" });

    expect(upload.status).toBe(200);
    expect(upload.body.photoVersion).toBe(1);
    await rm(join(tempDir, "uploads"), { recursive: true, force: true });

    const read = await request(createApp({ dataDir: tempDir })).get("/api/profile/photo");
    expect(read.status).toBe(200);
    expect(Buffer.from(read.body)).toEqual(pngSignature);
    expect(read.headers["content-type"]).toContain("image/png");
    expect(read.headers["x-content-type-options"]).toBe("nosniff");
    expect(read.headers.etag).toBe('"profile-photo-1"');
    expect(await readdir(join(tempDir, "uploads"))).toEqual([]);
  });

  it("accepts JPEG, PNG, and WebP signatures regardless of the client-provided filename", async () => {
    const images = [
      { bytes: Buffer.from([0xff, 0xd8, 0xff, 0x00]), mimeType: "image/jpeg" },
      { bytes: pngSignature, mimeType: "image/png" },
      { bytes: Buffer.from("RIFF\x04\x00\x00\x00WEBP", "binary"), mimeType: "image/webp" }
    ];

    for (const [index, image] of images.entries()) {
      const app = createApp({ dataDir: tempDir });
      const response = await request(app)
        .post("/api/profile/photo")
        .attach("photo", image.bytes, { filename: "untrusted.txt", contentType: "text/plain" });

      expect(response.status).toBe(200);
      expect(response.body.photoVersion).toBe(index + 1);
      const photo = await request(app).get("/api/profile/photo");
      expect(photo.headers["content-type"]).toContain(image.mimeType);
      expect(Buffer.from(photo.body)).toEqual(image.bytes);
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

  it("rejects multipart fields with the same sanitized limit response", async () => {
    const response = await request(createApp({ dataDir: tempDir }))
      .post("/api/profile/photo")
      .field("unexpected", "value")
      .attach("photo", pngSignature, { filename: "photo.png", contentType: "image/png" });

    expect(response.status).toBe(413);
    expect(response.body).toEqual({ error: { message: "Profile photo must be 5 MB or smaller", code: "PAYLOAD_TOO_LARGE" } });
  });

  it("repairs a positive version for an otherwise valid persisted photo row", async () => {
    const paths = resolveAppPaths({ dataDir: tempDir });
    const database = openDatabase(paths);
    database.prepare("UPDATE profile SET photo_blob = ?, photo_mime = ?, photo_version = 0 WHERE id = 1").run(pngSignature, "image/png");
    database.close();

    const profile = await request(createApp({ dataDir: tempDir })).get("/api/profile");
    expect(profile.body.photoVersion).toBe(1);
    expect((await request(createApp({ dataDir: tempDir })).get("/api/profile/photo")).status).toBe(200);
    const uploaded = await request(createApp({ dataDir: tempDir })).post("/api/profile/photo").attach("photo", pngSignature, { filename: "next.png", contentType: "image/png" });
    expect(uploaded.body.photoVersion).toBe(2);
    expect((await request(createApp({ dataDir: tempDir })).get("/api/profile/photo")).headers.etag).toBe('"profile-photo-2"');
  });

  it("normalizes an unusable maximum-safe version before upload and always returns a usable stored version", async () => {
    const paths = resolveAppPaths({ dataDir: tempDir });
    const database = openDatabase(paths);
    database.prepare("UPDATE profile SET photo_blob = ?, photo_mime = ?, photo_version = ? WHERE id = 1").run(pngSignature, "image/png", Number.MAX_SAFE_INTEGER);
    database.close();

    expect((await request(createApp({ dataDir: tempDir })).get("/api/profile")).body.photoVersion).toBe(1);
    const upload = await request(createApp({ dataDir: tempDir })).post("/api/profile/photo").attach("photo", pngSignature, { filename: "next.png", contentType: "image/png" });
    expect(upload.body.photoVersion).toBe(2);
    expect((await request(createApp({ dataDir: tempDir })).get("/api/profile/photo")).status).toBe(200);
    expect((await request(createApp({ dataDir: tempDir })).get("/api/profile")).body.photoVersion).toBe(2);
  });

  it("preserves the maximum usable version and rejects its next upload without changing the stored photo", async () => {
    const paths = resolveAppPaths({ dataDir: tempDir });
    const database = openDatabase(paths);
    database.prepare("UPDATE profile SET photo_blob = ?, photo_mime = ?, photo_version = ? WHERE id = 1").run(pngSignature, "image/png", Number.MAX_SAFE_INTEGER - 2);
    database.close();
    const app = createApp({ dataDir: tempDir });
    const reachedMaximum = await request(app).post("/api/profile/photo").attach("photo", Buffer.concat([pngSignature, Buffer.from([1])]), { filename: "maximum.png", contentType: "image/png" });
    expect(reachedMaximum.body.photoVersion).toBe(Number.MAX_SAFE_INTEGER - 1);
    const before = await request(app).get("/api/profile/photo");
    expect(before.status).toBe(200);
    expect(before.headers.etag).toBe(`"profile-photo-${Number.MAX_SAFE_INTEGER - 1}"`);
    expect((await request(createApp({ dataDir: tempDir })).get("/api/profile")).body.photoVersion).toBe(Number.MAX_SAFE_INTEGER - 1);
    const rejected = await request(app).post("/api/profile/photo").attach("photo", pngSignature, { filename: "overflow.png", contentType: "image/png" });
    expect(rejected.status).toBe(409);
    expect(rejected.body).toEqual({ error: { message: "头像版本已达到上限", code: "PHOTO_VERSION_EXHAUSTED" } });
    const after = await request(app).get("/api/profile/photo");
    expect(after.headers.etag).toBe(before.headers.etag);
    expect(Buffer.from(after.body)).toEqual(Buffer.from(before.body));
  });

  it("increments photo version atomically and supports version ETags", async () => {
    const app = createApp({ dataDir: tempDir });
    const first = await request(app)
      .post("/api/profile/photo")
      .attach("photo", pngSignature, { filename: "first.png", contentType: "image/png" });
    const secondImage = Buffer.concat([pngSignature, Buffer.from([0x01])]);
    const second = await request(app)
      .post("/api/profile/photo")
      .attach("photo", secondImage, { filename: "second.png", contentType: "image/png" });

    expect(first.body.photoVersion).toBe(1);
    expect(second.body.photoVersion).toBe(2);
    const read = await request(app).get("/api/profile/photo");
    expect(read.headers.etag).toBe('"profile-photo-2"');
    expect(Buffer.from(read.body)).toEqual(secondImage);
    expect((await request(app).get("/api/profile/photo").set("If-None-Match", '"profile-photo-2"')).status).toBe(304);
  });

  it("returns 404 for absent photos and all old parameterized photo paths", async () => {
    const app = createApp({ dataDir: tempDir });

    expect((await request(app).get("/api/profile/photo")).status).toBe(404);
    expect((await request(app).get("/api/profile/photo/..%2Fprofile.sqlite")).status).toBe(404);
    expect((await request(app).get("/api/profile/photo/not-referenced.png")).status).toBe(404);
  });

  it("closes the per-request database handle once when an incomplete multipart upload disconnects", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    let opened!: () => void;
    let closed!: () => void;
    const openedPromise = new Promise<void>((resolve) => { opened = resolve; });
    const closedPromise = new Promise<void>((resolve) => { closed = resolve; });
    let closeCalls = 0;
    const app = createApp({
      dataDir: tempDir,
      profileDatabaseOpener: (paths) => {
        const database = openDatabase(paths);
        const originalClose = database.close.bind(database);
        database.close = () => { closeCalls += 1; originalClose(); closed(); return database; };
        opened();
        return database;
      }
    });
    const server = createServer(app);
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const port = (server.address() as { port: number }).port;
    const socket = connect(port, "127.0.0.1");
    await new Promise<void>((resolve, reject) => { socket.once("connect", resolve); socket.once("error", reject); });
    socket.write("POST /api/profile/photo HTTP/1.1\r\nHost: 127.0.0.1\r\nContent-Type: multipart/form-data; boundary=boundary\r\nContent-Length: 99999\r\n\r\n--boundary\r\nContent-Disposition: form-data; name=\"photo\"; filename=\"photo.png\"\r\nContent-Type: image/png\r\n\r\n");
    await openedPromise;
    socket.destroy();
    await closedPromise;
    expect(closeCalls).toBe(1);
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await expect(rm(tempDir, { recursive: true, force: true })).resolves.toBeUndefined();
    openDatabase(resolveAppPaths({ dataDir: tempDir })).close();
    expect(errorSpy).not.toHaveBeenCalled();
    errorSpy.mockRestore();
  }, 15_000);
});
