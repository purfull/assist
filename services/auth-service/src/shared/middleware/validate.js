const { validationResult } = require('express-validator');

/**
 * Ends the request with 400 and the validation errors if any express-validator
 * rule before it failed. Put it last in each validation chain.
 */
const handleValidationErrors = (req, res, next) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
        return res.status(400).json({ errors: errors.array() });
    }
    next();
};

module.exports = { handleValidationErrors };
