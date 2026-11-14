// #531: the same rules as metrics-v2-nyc-day.test.ts on three Random city seeds built from the same committed
// cache (fixtures/nyc). The seeds are arbitrary; the rules are read from each run, never from a pinned number.
import { RANDOM_SEEDS, describeDayRules, randomRequest } from './metrics-v2-nyc-helper';

for (const seed of RANDOM_SEEDS) describeDayRules(`Random city, seed ${seed}`, randomRequest(seed));
