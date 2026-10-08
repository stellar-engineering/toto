// Pictures in a conversation: screenshots an agent took, and ones a person sent it. They are kept
// as files beside the conversation, and the conversation holds only a reference to each, because
// a conversation is replayed whole to every phone that connects and a picture is far too big for that.
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { ImageRef } from '../../protocol.ts';
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

export const dropImages = (agentId: string, root = dataDir) => isAgent(agentId) && rmSync(folder(agentId, root), { recursive: true, force: true });
