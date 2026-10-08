// Where the app keeps what it knows between launches: the phone's keychain. (The browser's
// version is storage.web.ts.)
import * as SecureStore from 'expo-secure-store';

export const read = (key: string): string | null => SecureStore.getItem(key);
export const write = (key: string, value: string) => SecureStore.setItem(key, value);
