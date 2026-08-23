import { createReadStream, type ReadStream } from "node:fs";
import { Router, type Response } from "express";
import type { BackupExporter, BackupSnapshot } from "./backup.service.js";

export type BackupReadStreamFactory = (filePath: string) => ReadStream;

export interface BackupRouterDependencies {
  exporter: BackupExporter;
  createFileStream?: BackupReadStreamFactory;
}

const failureBody = { error: { message: "导出失败，请稍后重试", code: "BACKUP_EXPORT_FAILED" } };

function fail(response: Response): void {
  console.error("Backup export failed");
  if (!response.headersSent && !response.destroyed) {
    response.removeHeader("Content-Disposition");
    response.removeHeader("Content-Type");
    response.removeHeader("X-Content-Type-Options");
    response.removeHeader("Cache-Control");
    response.status(500).json(failureBody);
  } else if (!response.destroyed) response.destroy();
}

export function createBackupRouter({ exporter, createFileStream = createReadStream }: BackupRouterDependencies): Router {
  const router = Router();

  router.post("/backup/export", async (request, response) => {
    const abortController = new AbortController();
    let clientDisconnected = request.aborted || response.destroyed;
    const markClientDisconnected = () => {
      clientDisconnected = true;
      abortController.abort();
    };
    request.once("aborted", markClientDisconnected);
    response.once("close", markClientDisconnected);
    let snapshot: BackupSnapshot;
    try {
      snapshot = await exporter.createSnapshot(abortController.signal);
    } catch {
      request.off("aborted", markClientDisconnected);
      response.off("close", markClientDisconnected);
      if (!clientDisconnected && !request.aborted && !response.destroyed) fail(response);
      return;
    }
    request.off("aborted", markClientDisconnected);
    response.off("close", markClientDisconnected);

    let cleanupStarted = false;
    const cleanup = () => {
      if (cleanupStarted) return;
      cleanupStarted = true;
      void snapshot.cleanup().catch(() => console.error("Backup export failed"));
    };
    if (clientDisconnected || request.aborted || response.destroyed) {
      cleanup();
      return;
    }
    let stream: ReadStream;
    try {
      stream = createFileStream(snapshot.filePath);
    } catch {
      cleanup();
      fail(response);
      return;
    }

    stream.once("close", cleanup);
    stream.once("error", () => {
      stream.unpipe(response);
      fail(response);
      if (!stream.destroyed) stream.destroy();
    });

    const stopStreaming = () => {
      if (stream.closed) cleanup();
      else if (!stream.destroyed) stream.destroy();
    };
    response.once("finish", stopStreaming);
    response.once("close", stopStreaming);
    response.once("error", stopStreaming);

    try {
      response.setHeader("Content-Type", "application/vnd.sqlite3");
      response.setHeader("Content-Disposition", `attachment; filename="${snapshot.filename}"`);
      response.setHeader("X-Content-Type-Options", "nosniff");
      response.setHeader("Cache-Control", "private, no-store");
      stream.pipe(response);
    } catch {
      stream.unpipe(response);
      if (!stream.destroyed) stream.destroy();
      fail(response);
    }
  });

  return router;
}
