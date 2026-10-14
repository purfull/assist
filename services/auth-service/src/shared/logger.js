const platform = require('@ai-search/platform');

// Service-wide structured logger. Inside request handlers prefer req.log (adds the request id).
module.exports = platform.createLogger('auth-service');
