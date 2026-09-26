import { Router } from 'express';
import Busboy from 'busboy';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import fssync from 'node:fs';
import path from 'node:path';
import { errors } from '../core/errors.js';
import { randomId } from '../core/crypto.js';
import { config } from '../core/config.js';
import { extractReadableText } from '../tools/html.js';
import { extractPdfText } from '../services/pdf.js';

const IMAGE_MIMES = new Set(['image/png', 'image/jpeg', 'image/webp', 'image/gif']);
const TEXT_MIMES = new Set([
  'text/plain', 'text/markdown', 'text/csv', 'application/json', 'application/xml', 'text/html',
  'text/javascript', 'application/javascript', 'text/x-python',
]);

export function createFileRoutes({ repos }) {
  const router = Router();

  function kindFor(mime, filename) {
    if (IMAGE_MIMES.has(mime)) return 'image';
    if (mime === 'application/pdf' || filename.toLowerCase().endsWith('.pdf')) return 'pdf';
    if (TEXT_MIMES.has(mime)) return 'text';
    if (/\.(txt|md|csv|json|ya?ml|js|ts|py|html|css|xml|sh|toml|ini|log)$/i.test(filename)) return 'text';
    return 'other';
  }

  router.get('/', (req, res) => {
    const files = repos.files.list(req.auth.userId, {
      projectId: req.query.projectId || null,
      conversationId: req.query.conversationId || null,
    });
    res.json({ files });
  });

  router.post('/', (req, res, next) => {
    let busboy;
    try {
      busboy = Busboy({ headers: req.headers, limits: { fileSize: config.limits.maxUploadBytes, files: 5 } });
    } catch {
      return next(errors.badRequest('Invalid multipart request'));
    }

    const saved = [];
    const uploadErrors = [];
    let openStreams = 0;
    let busboyDone = false;
    let responded = false;

    const maybeFinish = () => {
      if (responded || !busboyDone || openStreams > 0) return;
      responded = true;
      res.status(201).json({ files: saved, errors: uploadErrors });
    };

    busboy.on('finish', () => {
      busboyDone = true;
      maybeFinish();
    });
    busboy.on('error', (err) => {
      if (!responded) next(errors.badRequest(`Upload failed: ${err.message}`));
    });

    busboy.on('file', async (name, stream, info) => {
      openStreams++;
      const { filename, mimeType } = info;
      if (!filename) {
        stream.resume();
        openStreams--;
        return;
      }
      const safeName = path.basename(filename).replace(/[\\/:*?"<>|]/g, '_').slice(0, 200) || 'file';
      const kind = kindFor(mimeType, safeName);
      const id = randomId('file');
      const relPath = path.join(req.auth.userId, `${id}_${safeName}`);
      const absPath = path.join(config.filesDir, relPath);
      const hash = crypto.createHash('sha256');

      await fs.mkdir(path.join(config.filesDir, req.auth.userId), { recursive: true });
      const ws = fssync.createWriteStream(absPath);
      let size = 0;
      let truncated = false;

      stream.on('data', (chunk) => {
        hash.update(chunk);
        size += chunk.length;
      });
      stream.on('limit', () => {
        truncated = true;
      });
      stream.pipe(ws);

      ws.on('error', (err) => {
        uploadErrors.push({ filename: safeName, error: err.message });
        openStreams--;
        maybeFinish();
      });

      ws.on('finish', async () => {
        try {
          if (truncated) {
            uploadErrors.push({ filename: safeName, error: `File exceeds ${config.limits.maxUploadBytes / 1024 / 1024} MB limit` });
            await fs.rm(absPath, { force: true });
          } else {
            let extractedText = null;
            if (kind === 'text' && size <= 2_000_000) {
              try {
                extractedText = extractReadableText(await fs.readFile(absPath, 'utf8'), { maxChars: 60_000 });
              } catch {
                /* non-utf8 text file — skip extraction */
              }
            } else if (kind === 'pdf' && size <= 20_000_000) {
              try {
                extractedText = extractPdfText(await fs.readFile(absPath));
              } catch {
                /* unsupported PDF — stays null, surfaced honestly in the UI */
              }
            }
            repos.files.insert({
              id,
              userId: req.auth.userId,
              projectId: req.query.projectId || null,
              conversationId: req.query.conversationId || null,
              filename: safeName,
              mime: mimeType || 'application/octet-stream',
              size,
              storagePath: relPath,
              sha256: hash.digest('hex'),
              kind,
              extractedText,
            });
            saved.push(repos.files.get(req.auth.userId, id));
          }
        } catch (err) {
          uploadErrors.push({ filename: safeName, error: err.message });
        }
        openStreams--;
        maybeFinish();
      });
    });

    req.pipe(busboy);
  });

  router.get('/:id/download', (req, res, next) => {
    try {
      const file = repos.files.get(req.auth.userId, req.params.id);
      if (!file) throw errors.notFound('File');
      const absPath = path.join(config.filesDir, file.storagePath);
      res.setHeader('Content-Type', file.mime);
      res.setHeader('Content-Disposition', `inline; filename="${encodeURIComponent(file.filename)}"`);
      res.setHeader('Cache-Control', 'private, max-age=31536000, immutable');
      fssync
        .createReadStream(absPath)
        .on('error', () => next(errors.notFound('File content')))
        .pipe(res);
    } catch (err) {
      next(err);
    }
  });

  router.get('/:id/content', (req, res, next) => {
    try {
      const file = repos.files.get(req.auth.userId, req.params.id);
      if (!file) throw errors.notFound('File');
      const raw = repos.files.getRaw(file.id);
      res.json({ file, extractedText: raw.extracted_text || null });
    } catch (err) {
      next(err);
    }
  });

  router.delete('/:id', async (req, res, next) => {
    try {
      const file = repos.files.get(req.auth.userId, req.params.id);
      if (!file) throw errors.notFound('File');
      await fs.rm(path.join(config.filesDir, file.storagePath), { force: true });
      repos.files.delete(req.auth.userId, file.id);
      res.json({ ok: true });
    } catch (err) {
      next(err);
    }
  });

  return router;
}

export { IMAGE_MIMES };
