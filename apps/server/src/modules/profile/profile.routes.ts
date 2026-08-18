import { randomUUID } from "node:crypto";
import { existsSync, promises as fs } from "node:fs";
import { basename, extname, resolve, sep } from "node:path";
import { Router } from "express";
import multer from "multer";
import { ProfileUpdateSchema } from "@workbench/contracts";
import type { AppPaths } from "../../config/paths.js";
import { openDatabase } from "../../db/database.js";
import { ProfileRepository } from "./profile.repository.js";

const maxPhotoBytes = 5 * 1024 * 1024;
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: maxPhotoBytes + 1 } });

interface ImageType {
  extension: ".jpg" | ".png" | ".webp";
  mimeType: "image/jpeg" | "image/png" | "image/webp";
}

function identifyImage(buffer: Buffer): ImageType | null {
  if (buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) {
    return { extension: ".jpg", mimeType: "image/jpeg" };
  }
  if (buffer.length >= 8 && buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) {
    return { extension: ".png", mimeType: "image/png" };
  }
  if (buffer.length >= 12 && buffer.subarray(0, 4).toString("ascii") === "RIFF" && buffer.subarray(8, 12).toString("ascii") === "WEBP") {
    return { extension: ".webp", mimeType: "image/webp" };
  }
  return null;
}

function isSafePhotoFilename(filename: string): boolean {
  return basename(filename) === filename && /^[a-f0-9-]+\.(?:jpg|png|webp)$/.test(filename);
}

export function createProfileRouter(paths: AppPaths): Router {
  const router = Router();

  router.use((_request, response, next) => {
    const database = openDatabase(paths);
    response.locals.profileRepository = new ProfileRepository(database);
    response.once("finish", () => database.close());
    next();
  });

  function repositoryFor(response: Parameters<Parameters<Router["get"]>[1]>[1]): ProfileRepository {
    return response.locals.profileRepository as ProfileRepository;
  }

  router.get("/profile", (_request, response) => {
    response.json(repositoryFor(response).get());
  });

  router.put("/profile", (request, response) => {
    const parsed = ProfileUpdateSchema.safeParse(request.body);
    if (!parsed.success) {
      response.status(400).json({ error: { message: "Profile validation failed", code: "VALIDATION_ERROR", fields: parsed.error.flatten().fieldErrors } });
      return;
    }
    response.json(repositoryFor(response).update(parsed.data));
  });

  router.post("/profile/photo", upload.single("photo"), async (request, response, next) => {
    try {
      if (!request.file) {
        response.status(400).json({ error: { message: "A profile photo is required", code: "VALIDATION_ERROR" } });
        return;
      }
      const image = identifyImage(request.file.buffer);
      if (!image) {
        response.status(415).json({ error: { message: "Only JPEG, PNG, or WebP images are supported", code: "UNSUPPORTED_MEDIA_TYPE" } });
        return;
      }
      if (request.file.buffer.length > maxPhotoBytes) {
        response.status(413).json({ error: { message: "Profile photo must be 5 MB or smaller", code: "PAYLOAD_TOO_LARGE" } });
        return;
      }

      const filename = `${randomUUID()}${image.extension}`;
      await fs.writeFile(resolve(paths.uploadsDir, filename), request.file.buffer, { flag: "wx" });
      response.json(repositoryFor(response).setPhotoFilename(filename));
    } catch (error) {
      next(error);
    }
  });

  router.get("/profile/photo/:filename", (request, response) => {
    const filename = request.params.filename;
    if (!isSafePhotoFilename(filename) || !repositoryFor(response).referencesPhoto(filename)) {
      response.status(404).json({ error: { message: "Not Found", code: "NOT_FOUND" } });
      return;
    }

    const photoPath = resolve(paths.uploadsDir, filename);
    if (!photoPath.startsWith(`${resolve(paths.uploadsDir)}${sep}`) || !existsSync(photoPath)) {
      response.status(404).json({ error: { message: "Not Found", code: "NOT_FOUND" } });
      return;
    }
    response.type(extname(filename)).sendFile(photoPath);
  });

  return router;
}

export function isPhotoUploadLimitError(error: unknown): boolean {
  return error instanceof multer.MulterError && error.code === "LIMIT_FILE_SIZE";
}
