const fs = require('fs');
const os = require('os');
const path = require('path');
const { Readable } = require('stream');

const { createBackupMiddleware } = require('./backup-middleware');

const backup = (note) => JSON.stringify({ app: 'expenses-app', format: 1, tables: {}, note });

/** Sends one request through the middleware and resolves with what it answered. */
function call(middleware, { method = 'PUT', url = '/__backup/latest.json', type = 'application/json', body = '' }) {
  return new Promise((resolve) => {
    const req = Object.assign(Readable.from(body ? [Buffer.from(body)] : []), {
      method,
      url,
      headers: type ? { 'content-type': type } : {},
    });
    const res = {
      statusCode: 200,
      setHeader() {},
      end(text) {
        resolve({ status: this.statusCode, body: JSON.parse(text) });
      },
    };
    middleware(req, res, () => resolve({ passedOn: true }));
  });
}

describe('backup middleware', () => {
  let dir;
  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'backup-test-'));
  });
  afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

  const read = (name) => fs.readFileSync(path.join(dir, name), 'utf8');

  it('leaves every other request to the dev server', async () => {
    expect(await call(createBackupMiddleware({ dir }), { url: '/index.bundle' })).toEqual({ passedOn: true });
  });

  it('writes the backup, and overwrites it on the next save', async () => {
    const middleware = createBackupMiddleware({ dir });
    expect((await call(middleware, { body: backup('one') })).status).toBe(200);
    expect((await call(middleware, { body: backup('two') })).status).toBe(200);
    expect(read('latest.json')).toBe(backup('two'));
    expect(fs.readdirSync(dir)).toEqual(['latest.json']);
  });

  it('creates the folder when it is missing', async () => {
    const nested = path.join(dir, 'not', 'there');
    expect((await call(createBackupMiddleware({ dir: nested }), { body: backup('one') })).status).toBe(200);
    expect(fs.existsSync(path.join(nested, 'latest.json'))).toBe(true);
  });

  it('refuses what is not a backup, and keeps the file it had', async () => {
    const middleware = createBackupMiddleware({ dir });
    await call(middleware, { body: backup('good') });
    expect((await call(middleware, { body: 'not json' })).status).toBe(400);
    expect((await call(middleware, { body: JSON.stringify({ app: 'other', tables: {} }) })).status).toBe(400);
    expect((await call(middleware, { body: backup('x'), type: 'text/plain' })).status).toBe(415);
    expect((await call(middleware, { method: 'GET' })).status).toBe(405);
    expect(read('latest.json')).toBe(backup('good'));
  });

  it('refuses names that could leave the folder', async () => {
    const middleware = createBackupMiddleware({ dir });
    for (const url of ['/__backup/../evil.json', '/__backup/a/b.json', '/__backup/latest.2026-10-08.json', '/__backup/x.txt']) {
      expect((await call(middleware, { url, body: backup('x') })).status).toBe(400);
    }
    expect(fs.readdirSync(dir)).toEqual([]);
  });

  it('keeps one dated copy per day, and only the newest few', async () => {
    let today = new Date(2026, 9, 1, 12);
    const middleware = createBackupMiddleware({ dir, keepDays: 2, now: () => today });
    for (let day = 1; day <= 4; day++) {
      today = new Date(2026, 9, day, 12);
      for (const time of ['morning', 'evening']) {
        await call(middleware, { body: backup(`day ${day} ${time}`) });
        // The file's own date is what tells a later save that it is from an earlier day.
        fs.utimesSync(path.join(dir, 'latest.json'), today, today);
      }
    }
    expect(fs.readdirSync(dir).sort()).toEqual(['latest.2026-10-02.json', 'latest.2026-10-03.json', 'latest.json']);
    expect(read('latest.2026-10-03.json')).toBe(backup('day 3 evening'));
    expect(read('latest.json')).toBe(backup('day 4 evening'));
  });
});
