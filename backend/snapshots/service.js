














import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { config } from '../core/config.js';
import { logger } from '../core/logger.js';
import { workspaceDirFor } from '../tools/file-tools.js';

const log = logger('snapshots');
const MAX_FILES = 2000;
const MAX_FILE_BYTES = 8 * 1024 * 1024;
const SKIP_DIRS = new Set(['node_modules', '.git', '.zeno-snapshots', 'dist', 'build', '.next']);

const MUTATING_TOOLS = new Set(['file_write', 'file_edit', 'file_delete', 'terminal', 'code_exec']);

export function createSnapshotService({ repos, telemetry }) {
  function rootFor(userId) {
    return workspaceDirFor(userId);
  }
  function storeFor(userId) {
    return path.join(config.dataDir, 'snapshots', userId);
  }

  function assertInside(target, root) {
    const resolved = path.resolve(target);
    const r = path.resolve(root);
    if (resolved !== r && !resolved.startsWith(r + path.sep)) {
      throw new Error('Snapshot path escapes the workspace root');
    }
    return resolved;
  }

  async function hashFile(file) {
    const buf = await fs.readFile(file);
    return { hash: crypto.createHash('sha256').update(buf).digest('hex'), bytes: buf.length, buf };
  }

  
  async function putBlob(userId, buf, hash) {
    const dir = path.join(storeFor(userId), 'blobs');
    await fs.mkdir(dir, { recursive: true });
    const dest = path.join(dir, hash);
    try {
      await fs.access(dest);
      return hash; 
    } catch {
      
    }
    await fs.writeFile(dest, buf);
    return hash;
  }

  
  async function capture(userId, { sessionId = null, runId = null, label = 'checkpoint', emit = null } = {}) {
    const root = rootFor(userId);
    await fs.mkdir(root, { recursive: true });
    const manifest = [];
    let bytes = 0;
    const stack = [root];
    while (stack.length && manifest.length < MAX_FILES) {
      const dir = stack.pop();
      let entries;
      try {
        entries = await fs.readdir(dir, { withFileTypes: true });
      } catch {
        continue;
      }
      for (const ent of entries) {
        if (manifest.length >= MAX_FILES) break;
        if (ent.name.startsWith('.zeno-') || SKIP_DIRS.has(ent.name)) continue;
        const full = path.join(dir, ent.name);
        if (ent.isDirectory()) {
          stack.push(full);
          continue;
        }
        if (!ent.isFile()) continue;
        try {
          const stat = await fs.stat(full);
          if (stat.size > MAX_FILE_BYTES) continue;
          const { hash, bytes: len, buf } = await hashFile(full);
          await putBlob(userId, buf, hash);
          bytes += len;
          manifest.push({ path: path.relative(root, full).replace(/\\/g, '/'), hash, size: stat.size, mode: stat.mode & 0o777 });
        } catch {
          
        }
      }
    }

    const id = `snap_${Date.now().toString(36)}_${crypto.randomBytes(4).toString('hex')}`;
    const dir = path.join(storeFor(userId), 'snapshots');
    await fs.mkdir(dir, { recursive: true });
    const record = { id, userId, sessionId, runId, label, files: manifest, bytes, createdAt: Date.now(), gitHead: await gitHead(root) };
    await fs.writeFile(path.join(dir, `${id}.json`), JSON.stringify(record), 'utf8');
    log.info(`snapshot ${id} (${manifest.length} files, ${bytes}B, ${label})`);
    emit?.('snapshot/captured', { snapshotId: id, label, files: manifest.length, bytes });
    return record;
  }

  async function load(userId, snapshotId) {
    const file = path.join(storeFor(userId), 'snapshots', `${snapshotId}.json`);
    assertInside(file, storeFor(userId));
    const raw = await fs.readFile(file, 'utf8');
    return JSON.parse(raw);
  }

  
  async function restore(userId, snapshotId, { emit = null, direction = 'restored' } = {}) {
    const snap = await load(userId, snapshotId);
    const root = rootFor(userId);
    const want = new Map(snap.files.map((f) => [f.path, f]));

    
    const current = [];
    const stack = [root];
    while (stack.length && current.length < MAX_FILES * 2) {
      const dir = stack.pop();
      let entries;
      try {
        entries = await fs.readdir(dir, { withFileTypes: true });
      } catch {
        continue;
      }
      for (const ent of entries) {
        if (ent.name.startsWith('.zeno-') || SKIP_DIRS.has(ent.name)) continue;
        const full = path.join(dir, ent.name);
        if (ent.isDirectory()) stack.push(full);
        else if (ent.isFile()) current.push(path.relative(root, full).replace(/\\/g, '/'));
      }
    }
    let removed = 0;
    let written = 0;
    for (const rel of current) {
      if (want.has(rel)) continue;
      const full = assertInside(path.join(root, rel), root);
      await fs.rm(full, { force: true });
      removed++;
    }
    for (const f of snap.files) {
      const full = assertInside(path.join(root, f.path), root);
      const blobPath = path.join(storeFor(userId), 'blobs', f.hash);
      let existing = null;
      try {
        const st = await fs.stat(full);
        if (st.isFile()) existing = await hashFile(full);
      } catch {
        
      }
      if (existing?.hash === f.hash) continue; 
      const buf = await fs.readFile(blobPath);
      await fs.mkdir(path.dirname(full), { recursive: true });
      await fs.writeFile(full, buf, { mode: f.mode || 0o644 });
      written++;
    }
    log.info(`restore ${snapshotId}: ${written} written, ${removed} removed`);
    emit?.('snapshot/restored', { snapshotId, direction, written, removed });
    if (direction === 'restored') telemetry?.snapshotOp({ userId, sessionId: snap.sessionId || null, op: 'restore', snapshotId, files: snap.files.length });
    return { snapshotId, written, removed, files: snap.files.length };
  }

  async function gitHead(root) {
    try {
      const { execFile } = await import('node:child_process');
      const { promisify } = await import('node:util');
      const run = promisify(execFile);
      const { stdout } = await run('git', ['rev-parse', 'HEAD'], { cwd: root, timeout: 3000 });
      return stdout.trim();
    } catch {
      return null;
    }
  }

  
  function shouldCapture(tool, args) {
    if (!tool) return false;
    if (!MUTATING_TOOLS.has(tool.name)) return false;
    if (tool.name === 'terminal' || tool.name === 'code_exec') return true;
    return !!args?.path;
  }

  
  async function captureBefore(userId, { sessionId, runId, tool, args, emit }) {
    try {
      const rec = await capture(userId, { sessionId, runId, label: `${tool} ${args?.path || ''}`.trim(), emit });
      return rec.id;
    } catch (err) {
      log.warn(`snapshot capture failed (continuing without a checkpoint): ${err.message}`);
      return null;
    }
  }

  
  
  
  
  
  
  
  
  const pointers = new Map(); 
  const redoStacks = new Map(); 

  function checkpoints(sessionId) {
    if (!sessionId) return [];
    return repos.sessions
      .listEvents(sessionId)
      .filter((ev) => ev.type === 'snapshot/captured' && ev.data?.snapshotId)
      .map((ev) => ev.data.snapshotId);
  }

  function pointerFor(sessionId, total) {
    if (!pointers.has(sessionId)) pointers.set(sessionId, total);
    const p = Math.min(pointers.get(sessionId), total);
    pointers.set(sessionId, p);
    return p;
  }

  
  function recordCheckpoint(sessionId, snapshotId) {
    if (!sessionId || !snapshotId) return;
    redoStacks.delete(sessionId);
    pointers.set(sessionId, checkpoints(sessionId).length);
  }

  async function undo(userId, sessionId, { emit = null } = {}) {
    const list = checkpoints(sessionId);
    const pointer = pointerFor(sessionId, list.length);
    if (pointer <= 0) return { ok: false, error: 'Nothing to undo in this session.' };
    const id = list[pointer - 1];
    
    const before = await capture(userId, { sessionId, label: 'redo-point', emit: null });
    redoStacks.set(sessionId, [...(redoStacks.get(sessionId) || []), before.id]);
    pointers.set(sessionId, pointer - 1);
    const result = await restore(userId, id, { emit, direction: 'undo' });
    telemetry?.snapshotOp({ userId, sessionId, op: 'undo', snapshotId: id, files: result.files });
    return { ok: true, snapshotId: id, ...result };
  }

  async function redo(userId, sessionId, { emit = null } = {}) {
    const stack = redoStacks.get(sessionId) || [];
    const id = stack[stack.length - 1];
    if (!id) return { ok: false, error: 'Nothing to redo in this session.' };
    stack.pop();
    if (stack.length) redoStacks.set(sessionId, stack);
    else redoStacks.delete(sessionId);
    
    
    const before = await capture(userId, { sessionId, label: 'undo-point', emit });
    pointers.set(sessionId, checkpoints(sessionId).length);
    const result = await restore(userId, id, { emit, direction: 'redo' });
    telemetry?.snapshotOp({ userId, sessionId, op: 'redo', snapshotId: id, files: result.files });
    return { ok: true, snapshotId: id, ...result };
  }

  function stackState(sessionId) {
    if (!sessionId) return { canUndo: false, canRedo: false, undoDepth: 0, redoDepth: 0 };
    const list = checkpoints(sessionId);
    const pointer = pointerFor(sessionId, list.length);
    const redoDepth = (redoStacks.get(sessionId) || []).length;
    return { canUndo: pointer > 0, canRedo: redoDepth > 0, undoDepth: pointer, redoDepth };
  }

  return { capture, captureBefore, restore, shouldCapture, load, recordCheckpoint, undo, redo, stackState, rootFor };
}

let singleton = null;
export function getSnapshots(repos, telemetry) {
  if (!singleton) singleton = createSnapshotService({ repos, telemetry });
  return singleton;
}