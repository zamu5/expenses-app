// Learn more: https://docs.expo.dev/guides/customizing-metro
const { getDefaultConfig } = require('expo/metro-config');
const path = require('path');

const { createBackupMiddleware } = require('./server/backup-middleware');

const config = getDefaultConfig(__dirname);

// expo-sqlite on web runs SQLite compiled to WebAssembly.
config.resolver.assetExts.push('wasm');

// SQLite on web needs SharedArrayBuffer, which browsers only allow on cross-origin isolated pages.
// Automatic backup: the app sends its data to /__backup/<name>.json and it is written here.
// BACKUP_DIR and BACKUP_KEEP_DAYS (dated daily copies to keep) can be set in the environment.
const saveBackup = createBackupMiddleware({
  dir: path.resolve(__dirname, process.env.BACKUP_DIR || 'backup'),
  keepDays: Number(process.env.BACKUP_KEEP_DAYS ?? 7),
});

config.server.enhanceMiddleware = (middleware) => (req, res, next) => {
  res.setHeader('Cross-Origin-Embedder-Policy', 'credentialless');
  res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
  saveBackup(req, res, () => middleware(req, res, next));
};

module.exports = config;
