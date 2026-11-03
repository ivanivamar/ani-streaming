/** `config/access.allowedUids` — the only accounts that may read the catalogue. */
export const isAllowed = (uid: string, allowedUids: readonly string[] | null | undefined): boolean =>
  !!uid && !!allowedUids?.includes(uid);
