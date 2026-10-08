// Where the app keeps what it knows between launches: the phone's keychain. (The browser's
// version is storage.web.ts.)
import * as SecureStore from 'expo-secure-store';

export const read = (key: string): string | null => {
  try {
    return SecureStore.getItem(key);
  } catch {
    return null;
  }
};
export const write = (key: string, value: string) => {
  try {
    SecureStore.setItem(key, value);
  } catch {
    // A keychain that refuses must not take the app down with it. What was being saved is still
    // in use for now, and has to be set up again next launch.
  }
};
