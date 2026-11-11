/** Firefox and Safari can cancel a save whose URL is revoked at once; download helpers settle on 40 s. */
export const REVOKE_AFTER_MS = 40_000;

/** A blob has no name of its own, so it is saved through a throwaway link that carries one. */
export function saveFile(blob: Blob, fileName: string): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = fileName;
  // Some browsers ignore a click on a link that is not in the page.
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), REVOKE_AFTER_MS);
}
