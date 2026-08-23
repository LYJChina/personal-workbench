interface IpcParent {
  connected?: boolean;
  once(event: "disconnect", listener: () => void): unknown;
  exit(code?: number): unknown;
}

interface ClosableServer {
  close(callback: (error?: Error) => void): unknown;
  closeAllConnections(): unknown;
}

export function attachParentDisconnect(
  server: ClosableServer,
  parent: IpcParent = process,
  expectedIpc = false
): void {
  if (!expectedIpc) return;

  const shutdown = (exitCode: number) => {
    server.close((error) => parent.exit(error ? 1 : exitCode));
    server.closeAllConnections();
  };

  if (!parent.connected) {
    shutdown(1);
    return;
  }

  parent.once("disconnect", () => shutdown(0));
}
