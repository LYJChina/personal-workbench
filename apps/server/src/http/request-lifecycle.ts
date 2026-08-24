import type { Request, Response } from "express";

export function bindRequestLifecycle(
  request: Pick<Request, "once" | "aborted">,
  response: Pick<Response, "once" | "destroyed">,
  close: () => void
): AbortSignal {
  const controller = new AbortController();
  let closed = false;
  let finished = false;
  const closeOnce = () => {
    if (closed) return;
    closed = true;
    close();
  };
  const abortAndClose = () => {
    if (!finished && !controller.signal.aborted) controller.abort();
    closeOnce();
  };
  response.once("finish", () => {
    finished = true;
    closeOnce();
  });
  response.once("close", abortAndClose);
  request.once("aborted", abortAndClose);
  if (request.aborted || response.destroyed) abortAndClose();
  return controller.signal;
}

export function requestCanContinue(request: Request, response: Response, signal: AbortSignal): boolean {
  return !signal.aborted && !request.aborted && !response.destroyed;
}
