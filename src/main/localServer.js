/**
 * localServer.js
 *
 * Lightweight Express server on 127.0.0.1:7432.
 * Only accessible from localhost — never exposed externally.
 *
 * Endpoints:
 *   GET /health                    — liveness check
 *   GET /wado?filePath=<path>      — stream any local file for Cornerstone WADO-URI
 *   GET /thumbnail?path=<path>     — stream a pre-generated thumbnail
 *
 * Cornerstone uses imageIds like:
 *   wadouri:http://127.0.0.1:7432/wado?filePath=/absolute/path/to/scan.dcm
 */

const express = require('express');
const fs      = require('fs');
const path    = require('path');
const { app } = require('electron');
const log     = require('electron-log');

let server = null;

// Directories that are allowed to be served. Add more as needed.
function _allowedRoots() {
  return [
    app.getPath('userData'),
    app.getPath('downloads'),
    app.getPath('pictures'),
    app.getPath('temp'),
    // Common Windows install paths
    'C:\\DentalXRay',
    'C:\\ProgramData\\DentalXRayStudio',
    // Linux / macOS
    '/var/lib/dental-xray',
    '/Users',
    '/home',
    '/tmp',
  ];
}

function _isAllowed(filePath) {
  const resolved = path.resolve(filePath);
  return _allowedRoots().some(root => resolved.startsWith(path.resolve(root)));
}

async function startLocalServer() {
  const expressApp = express();

  // ── CORS (localhost only) ─────────────────────────────────────────────────
  expressApp.use((req, res, next) => {
    const origin = req.headers.origin || '';
    if (!origin || origin.startsWith('http://localhost') || origin.startsWith('file://')) {
      res.setHeader('Access-Control-Allow-Origin', '*');
    }
    next();
  });

  // ── Health ────────────────────────────────────────────────────────────────
  expressApp.get('/health', (_req, res) => {
    res.json({ status: 'ok', pid: process.pid });
  });

  // ── WADO-URI file serve ───────────────────────────────────────────────────
  expressApp.get('/wado', (req, res) => {
    const { filePath } = req.query;
    if (!filePath) return res.status(400).json({ error: 'filePath query param required' });

    const resolved = path.resolve(decodeURIComponent(filePath));

    if (!_isAllowed(resolved)) {
      log.warn('WADO: blocked access to', resolved);
      return res.status(403).json({ error: 'Access denied' });
    }
    if (!fs.existsSync(resolved)) {
      return res.status(404).json({ error: 'File not found' });
    }

    const ext = path.extname(resolved).toLowerCase();
    const contentTypeMap = {
      '.dcm':   'application/dicom',
      '.dicom': 'application/dicom',
      '.jpg':   'image/jpeg',
      '.jpeg':  'image/jpeg',
      '.png':   'image/png',
      '.bmp':   'image/bmp',
      '.tiff':  'image/tiff',
      '.tif':   'image/tiff',
    };
    const contentType = contentTypeMap[ext] || 'application/octet-stream';

    const stat = fs.statSync(resolved);
    res.setHeader('Content-Type', contentType);
    res.setHeader('Content-Length', stat.size);
    res.setHeader('Cache-Control', 'private, max-age=3600');

    const stream = fs.createReadStream(resolved);
    stream.on('error', err => {
      log.error('WADO stream error:', err.message);
      if (!res.headersSent) res.status(500).json({ error: err.message });
    });
    stream.pipe(res);
  });

  // ── Thumbnail serve ───────────────────────────────────────────────────────
  expressApp.get('/thumbnail', (req, res) => {
    const { path: thumbPath } = req.query;
    if (!thumbPath) return res.status(400).json({ error: 'path required' });

    const resolved = path.resolve(decodeURIComponent(thumbPath));
    if (!_isAllowed(resolved) || !fs.existsSync(resolved)) {
      return res.status(404).send('');
    }

    const ext = path.extname(resolved).toLowerCase();
    const ct  = ext === '.png' ? 'image/png' : 'image/jpeg';
    res.setHeader('Content-Type', ct);
    res.setHeader('Cache-Control', 'private, max-age=3600');
    fs.createReadStream(resolved).pipe(res);
  });

  // ── Start ─────────────────────────────────────────────────────────────────
  server = await new Promise((resolve, reject) => {
    const s = expressApp.listen(7432, '127.0.0.1', () => {
      log.info('WADO server ready on 127.0.0.1:7432');
      resolve(s);
    });
    s.on('error', reject);
  });

  return server;
}

function stopLocalServer() {
  if (server) { server.close(); server = null; }
}

module.exports = { startLocalServer, stopLocalServer };
