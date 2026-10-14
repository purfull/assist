import logger from '../logger';
import { validateEnv, type AuthConfig } from './env';

/**
 * Validated configuration, computed when this module is first imported. Import it
 * before any module that reads process.env at load time (JWT keys, Passport, Razorpay):
 * imports run in order, so a bad configuration exits here with a clear message.
 */
const load = (): AuthConfig => {
    try {
        return validateEnv();
    } catch (err) {
        logger.fatal(err instanceof Error ? err.message : String(err));
        process.exit(1);
    }
};

export const config = load();
