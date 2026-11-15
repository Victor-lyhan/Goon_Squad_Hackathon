// `npm run study` (MVP IV F3): Relay simulations on the cached NYC data vs a next-day courier baseline.
// Only the real command line and the exit code live here. Everything else is in scripts/study/, which
// tests/study/ imports (and so typechecks).
import { runStudyCli } from './study/cli';

process.exitCode = runStudyCli({ argv: process.argv.slice(2) });
