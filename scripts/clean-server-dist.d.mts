export type RemoveDirectory = (
  path: string,
  options: { recursive: true; force: true }
) => Promise<void>;

export const SERVER_DIST_DIRECTORY: string;
export function cleanServerDist(options?: { remove?: RemoveDirectory }): Promise<void>;
