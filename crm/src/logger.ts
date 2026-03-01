import { logger as engineLogger } from '../../engine/src/logger.js';

export const logger = engineLogger.child({ module: 'crm' });
