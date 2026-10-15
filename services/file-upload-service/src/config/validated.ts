import logger from '../shared/logger';
import { validateEnv, type FileServiceConfig } from './env';

/**
 * Validated configuration, computed when this module is first imported. Import it before
 * any module that reads process.env at load time; a bad configuration exits here.
 */
const load = (): FileServiceConfig => {
    try {
        return validateEnv();
    } catch (err) {
        logger.fatal(err instanceof Error ? err.message : String(err));
        process.exit(1);
    }
};

export const config = load();
