// `npm run fetch:routes` (run by a human; see `npm run fetch:routes -- --help`).
// Only the real command line and the exit code live here. Everything else, and every test, is in
// server/geo/fetchScript.ts, because the root tsconfig does not typecheck `scripts/`.
import { runFetchScript } from '../server/geo/fetchScript';

process.exitCode = await runFetchScript({ argv: process.argv.slice(2) });
