import { createLogger } from '@ai-search/platform';

// Service-wide structured logger. Inside request handlers prefer req.log (adds the request id).
const logger = createLogger('file-upload-service');

export default logger;
