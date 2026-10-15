/**
 * Side-effect import for unit tests: swaps Redis for an in-memory stub. Import right
 * after './env' and before any app code (imports run in order).
 */
import { installStubRedis } from './stubRedis';

export const stubRedis = installStubRedis();
