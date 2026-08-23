import { Router } from "express";
import multer from "multer";
import { ProfileUpdateSchema } from "@workbench/contracts";
import type { AppPaths } from "../../config/paths.js";
import { openDatabase } from "../../db/database.js";
import { ProfileRepository } from "./profile.repository.js";
import { PhotoVersionExhaustedError } from "./photo-version.js";

const maxPhotoBytes = 5 * 1024 * 1024;
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: maxPhotoBytes + 1, files: 1, fields: 0, parts: 2 } });

export interface ProfileRouterOptions {
  openDatabase?: typeof openDatabase;
}

interface ImageType {
  mimeType: "image/jpeg" | "image/png" | "image/webp";
}

function identifyImage(buffer: Buffer): ImageType | null {
  if (buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) {
    return { mimeType: "image/jpeg" };
  }
  if (buffer.length >= 8 && buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) {
    return { mimeType: "image/png" };
  }
  if (buffer.length >= 12 && buffer.subarray(0, 4).toString("ascii") === "RIFF" && buffer.subarray(8, 12).toString("ascii") === "WEBP") {
    return { mimeType: "image/webp" };
  }
  return null;
}

export function createProfileRouter(paths: AppPaths, options: ProfileRouterOptions = {}): Router {
  const router = Router();

  router.use((_request, response, next) => {
    const database = (options.openDatabase ?? openDatabase)(paths);
    response.locals.profileRepository = new ProfileRepository(database);
    let closed = false;
    const closeDatabase = () => {
      if (closed) return;
      closed = true;
      database.close();
    };
    response.once("finish", closeDatabase);
    response.once("close", closeDatabase);
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

  router.post("/profile/photo", upload.single("photo"), (request, response, next) => {
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

      response.json(repositoryFor(response).setPhoto({ bytes: request.file.buffer, mimeType: image.mimeType }));
    } catch (error) {
      if (error instanceof PhotoVersionExhaustedError) {
        response.status(409).json({ error: { message: "头像版本已达到上限", code: "PHOTO_VERSION_EXHAUSTED" } });
        return;
      }
      next(error);
    }
  });

  router.get("/profile/photo", (request, response) => {
    const photo = repositoryFor(response).getPhoto();
    if (!photo) {
      response.status(404).json({ error: { message: "Not Found", code: "NOT_FOUND" } });
      return;
    }
    const etag = `"profile-photo-${photo.version}"`;
    response.setHeader("ETag", etag);
    response.setHeader("X-Content-Type-Options", "nosniff");
    if (request.get("If-None-Match") === etag) {
      response.status(304).end();
      return;
    }
    response.type(photo.mimeType).send(photo.bytes);
  });

  return router;
}

export function isPhotoUploadLimitError(error: unknown): boolean {
  return error instanceof multer.MulterError;
}
