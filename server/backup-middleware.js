/**
 * Automatic backup, server side. The app cannot write to a folder on the Mac by itself, so the
 * dev server (Metro, see metro.config.js) does it: the app sends its backup to
 * PUT /__backup/<name>.json and this writes it into the backup folder, replacing the last one.
 *
 * Once a day, before the first overwrite, the file from the day before is kept as
 * <name>.YYYY-MM-DD.json, so one bad save (say, from a browser that lost its data) cannot
 * destroy the only good copy.
 */
const fs = require('fs');
const path = require('path');

const ROUTE = '/__backup/';
// Plain names only: nothing that could point outside the folder, or at a dated copy.
const FILE_NAME = /^[a-z0-9][a-z0-9-]*\.json$/;
const MAX_BYTES = 50 * 1024 * 1024;

const dayOf = (date) =>
  `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;

/** Keeps yesterday's (or older) file under a dated name, then drops dated copies beyond `keepDays`. */
function keepDailyCopy(dir, name, keepDays, now) {
  const file = path.join(dir, name);
  const base = name.slice(0, -'.json'.length);
  if (keepDays > 0 && fs.existsSync(file)) {
    const day = dayOf(fs.statSync(file).mtime);
    if (day !== dayOf(now)) fs.copyFileSync(file, path.join(dir, `${base}.${day}.json`));
  }
  const dated = fs
    .readdirSync(dir)
    .filter((f) => f.startsWith(`${base}.`) && /^\.\d{4}-\d{2}-\d{2}\.json$/.test(f.slice(base.length)))
    .sort();
  for (const old of dated.slice(0, Math.max(0, dated.length - keepDays))) fs.unlinkSync(path.join(dir, old));
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > MAX_BYTES) reject(Object.assign(new Error('The backup is too large.'), { status: 413 }));
      else chunks.push(chunk);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

/**
 * @param {{ dir: string, keepDays?: number, now?: () => Date }} options
 *   dir: the folder to write into. keepDays: how many dated daily copies to keep (0 for none).
 */
function createBackupMiddleware({ dir, keepDays = 7, now = () => new Date() }) {
  return async function backupMiddleware(req, res, next) {
    const url = (req.url || '').split('?')[0];
    if (!url.startsWith(ROUTE)) return next();

    const send = (status, body) => {
      res.statusCode = status;
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify(body));
    };

    const name = url.slice(ROUTE.length);
    if (!FILE_NAME.test(name)) return send(400, { error: 'Not a valid backup file name.' });
    if (req.method !== 'PUT') return send(405, { error: 'Use PUT to save a backup.' });
    // A web page on another site cannot send JSON here without the browser asking first, and this
    // server never says yes, so only the app itself can overwrite the backup.
    if (!String(req.headers['content-type'] || '').startsWith('application/json')) {
      return send(415, { error: 'Send the backup as application/json.' });
    }

    try {
      const text = await readBody(req);
      let backup;
      try {
        backup = JSON.parse(text);
      } catch {
        return send(400, { error: 'The backup is not valid JSON.' });
      }
      if (!backup || backup.app !== 'expenses-app' || typeof backup.tables !== 'object' || !backup.tables) {
        return send(400, { error: 'This is not a backup made by this app.' });
      }

      fs.mkdirSync(dir, { recursive: true });
      keepDailyCopy(dir, name, keepDays, now());
      // Write next to the file and rename, so a crash mid-write never leaves half a backup.
      const file = path.join(dir, name);
      const temp = `${file}.tmp`;
      fs.writeFileSync(temp, text);
      fs.renameSync(temp, file);
      return send(200, { ok: true, file: name, savedAt: now().toISOString() });
    } catch (e) {
      return send(e.status || 500, { error: e instanceof Error ? e.message : String(e) });
    }
  };
}

module.exports = { createBackupMiddleware };
