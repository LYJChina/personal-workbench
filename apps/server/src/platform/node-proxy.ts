import * as http from "node:http";

type ProxyAwareHttp = typeof http & { setGlobalProxyFromEnv?: () => () => void };

/** Use the user's configured HTTP(S)_PROXY/NO_PROXY values for Node fetch requests. */
export function configureNodeProxyFromEnvironment(): () => void {
  return (http as ProxyAwareHttp).setGlobalProxyFromEnv?.() ?? (() => undefined);
}
