// Setting a new Toto up over Bluetooth is the phone app's job. In a browser these say so.
import type { SetupInfo, SetupReply, SetupRequest } from '../../protocol';

export type { SetupInfo, SetupReply, WifiNetwork } from '../../protocol';
export type Found = { id: string; signal: number };
export type Setup = { info: SetupInfo; ask: (request: SetupRequest) => Promise<SetupReply>; close: () => void };

export const bluetooth = async (): Promise<'ready' | 'unsupported' | 'denied' | 'off'> => 'unsupported';
export const look = (_onFound: (toto: Found) => void): (() => void) => () => {};
export const openSetup = async (_id: string, _knownKey: (deviceId: string) => Uint8Array | undefined): Promise<Setup> => {
  throw new Error('Setting up over Bluetooth needs the phone app.');
};
