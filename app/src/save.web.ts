// Getting a picture out of the app, in a browser: a download.
const EXT: Record<string, string> = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/gif': 'gif', 'image/webp': 'webp' };

export async function savePicture(id: string, mime: string, base64: string) {
  const link = document.createElement('a');
  link.href = `data:${mime};base64,${base64}`;
  link.download = `toto-${id}.${EXT[mime] ?? 'png'}`;
  link.click();
}

export async function saveFile(id: string, name: string, mime: string, base64: string) {
  const link = document.createElement('a');
  link.href = `data:${mime};base64,${base64}`;
  link.download = name;
  link.click();
}
