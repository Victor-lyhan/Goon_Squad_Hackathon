import express from 'express';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const PORT = Number(process.env.PORT ?? 3001);
const clientDist = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../client/dist');

const app = express();
app.use(express.json());

app.get('/api/health', (_req, res) => {
  res.json({ ok: true });
});

// Unknown API paths never fall through to the SPA.
app.use('/api', (_req, res) => {
  res.status(404).json({ error: 'Not found' });
});

// `npm start`: serve the built client from the same origin (run `npm run build` first).
if (existsSync(clientDist)) {
  app.use(express.static(clientDist));
  app.use((req, res, next) => {
    if (req.method !== 'GET') return next();
    res.sendFile(path.join(clientDist, 'index.html'));
  });
}

app.listen(PORT, () => {
  console.log(`Relay API listening on http://localhost:${PORT}`);
});
