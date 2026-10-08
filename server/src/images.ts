// Pictures in a conversation: screenshots an agent took, and ones a person sent it. They are kept
// as files beside the conversation, and the conversation holds only a reference to each, because
// a conversation is replayed whole to every phone that connects and a picture is far too big for that.
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { FileRef, ImageRef } from '../../protocol.ts';
import { dataDir } from './projects.ts';

const TYPES = ['image/png', 'image/jpeg', 'image/gif', 'image/webp'];
export const MAX_IMAGE = 8 * 1024 * 1024;
const folder = (agentId: string, root: string) => join(root, 'images', agentId);
// Both come from a client, and both become part of a path.
const isAgent = (id: unknown): id is string => typeof id === 'string' && /^[0-9a-f]{8}$/.test(id);
const isImage = (id: unknown): id is string => typeof id === 'string' && /^[0-9a-f]{16}$/.test(id);

/** Keeps a picture for an agent's conversation. Undefined if it is not a picture we take, or is too big. */
export function saveImage(agentId: string, mime: unknown, base64: unknown, root = dataDir): ImageRef | undefined {
  if (!isAgent(agentId) || typeof mime !== 'string' || !TYPES.includes(mime) || typeof base64 !== 'string') return undefined;
  if (base64.length > (MAX_IMAGE * 4) / 3 + 4 || !/^[A-Za-z0-9+/]*={0,2}$/.test(base64)) return undefined;
  const bytes = Buffer.from(base64, 'base64');
  if (!bytes.length || bytes.length > MAX_IMAGE) return undefined;
  // Named for what is in it, so the same screenshot taken twice is kept once.
  const id = createHash('sha256').update(bytes).digest('hex').slice(0, 16);
  mkdirSync(folder(agentId, root), { recursive: true, mode: 0o700 });
  writeFileSync(join(folder(agentId, root), id), bytes, { mode: 0o600 });
  return { id, mime, bytes: bytes.length };
}

export function readImage(agentId: unknown, id: unknown, root = dataDir): Buffer | undefined {
  if (!isAgent(agentId) || !isImage(id)) return undefined;
  const file = join(folder(agentId, root), id);
  return existsSync(file) ? readFileSync(file) : undefined;
}

// Files an agent sent, kept the same way: beside the conversation, which holds only a reference.
export const MAX_FILE = 10 * 1024 * 1024;
const TYPES_BY_EXTENSION: Record<string, string> = { pdf: 'application/pdf', txt: 'text/plain', md: 'text/markdown', json: 'application/json', csv: 'text/csv', html: 'text/html', zip: 'application/zip', gz: 'application/gzip', tar: 'application/x-tar', png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp', log: 'text/plain' };
const filesIn = (agentId: string, root: string) => join(root, 'files', agentId);

/** Keeps a file an agent sent. Undefined if there is nothing in it or it is too big. */
export function saveFile(agentId: string, bytes: Buffer, name: string, root = dataDir): FileRef | undefined {
  if (!isAgent(agentId) || !bytes.length || bytes.length > MAX_FILE) return undefined;
  const id = createHash('sha256').update(bytes).digest('hex').slice(0, 16);
  // Only the name it ends in, and nothing that would not read as a name.
  const clean = (name.split('/').pop() ?? '').replace(/[\u0000-\u001f\u007f]/g, '').slice(-100) || 'file';
  mkdirSync(filesIn(agentId, root), { recursive: true, mode: 0o700 });
  writeFileSync(join(filesIn(agentId, root), id), bytes, { mode: 0o600 });
  return { id, name: clean, mime: TYPES_BY_EXTENSION[clean.split('.').pop()!.toLowerCase()] ?? 'application/octet-stream', bytes: bytes.length };
}

export function readFile(agentId: unknown, id: unknown, root = dataDir): Buffer | undefined {
  if (!isAgent(agentId) || !isImage(id)) return undefined;
  const file = join(filesIn(agentId, root), id);
  return existsSync(file) ? readFileSync(file) : undefined;
}

export const dropImages = (agentId: string, root = dataDir) => {
  if (!isAgent(agentId)) return;
  rmSync(folder(agentId, root), { recursive: true, force: true });
  rmSync(filesIn(agentId, root), { recursive: true, force: true });
};
