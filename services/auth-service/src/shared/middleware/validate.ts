import type { RequestHandler } from 'express';
import { validationResult } from 'express-validator';

/**
 * Ends the request with 400 and the validation errors if any express-validator
 * rule before it failed. Put it last in each validation chain.
 */
export const handleValidationErrors: RequestHandler = (req, res, next) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
        res.status(400).json({ errors: errors.array() });
        return;
    }
    next();
};
