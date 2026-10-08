// Getting a picture out of the app, on a phone: written to a file, then handed to the system's
// share sheet, which is where "Save image" lives. (The browser's version is save.web.ts.)
import { File, Paths } from 'expo-file-system';
import * as Sharing from 'expo-sharing';

const EXT: Record<string, string> = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/gif': 'gif', 'image/webp': 'webp' };

export async function savePicture(id: string, mime: string, base64: string) {
  const file = new File(Paths.cache, `toto-${id}.${EXT[mime] ?? 'png'}`);
  if (!file.exists) file.create();
  file.write(base64, { encoding: 'base64' });
  await Sharing.shareAsync(file.uri, { mimeType: mime, dialogTitle: 'Save picture' });
}
