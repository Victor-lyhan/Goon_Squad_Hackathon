// #531: the MVP II summary numbers on the REAL default NYC run, at every minute of the two days.
// The rules live in metrics-v2-nyc-helper.ts (`describeDayRules`) and are shared with the Random city seeds
// (metrics-v2-nyc-random.test.ts). Nothing here pins a story ID, a name or a count (DECISIONS pass 54).
import { DEFAULT_REQUEST, describeDayRules } from './metrics-v2-nyc-helper';

describeDayRules('default NYC run', DEFAULT_REQUEST);
