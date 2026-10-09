// Getting a picture out of the app, in a browser: a download.
const EXT: Record<string, string> = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/gif': 'gif', 'image/webp': 'webp' };

export async function savePicture(id: string, mime: string, base64: string) {
  const link = document.createElement('a');
  link.href = `data:${mime};base64,${base64}`;
  link.download = `toto-${id}.${EXT[mime] ?? 'png'}`;
  link.click();
}

/** Any other file an agent sent. A blob, not a data address: browsers refuse those past a few megabytes, and a file may be ten. */
export async function saveFile(id: string, name: string, mime: string, base64: string) {
  const bytes = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
  const link = document.createElement('a');
  link.href = URL.createObjectURL(new Blob([bytes], { type: mime }));
  link.download = name;
  link.click();
  setTimeout(() => URL.revokeObjectURL(link.href), 10_000);
}
