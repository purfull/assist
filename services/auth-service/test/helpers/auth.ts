import User from '../../src/modules/identity/models/User';
import * as tokens from '../../src/modules/identity/utils/jwtUtils';
import type { createSandbox } from './stub';

/**
 * Make `authenticate` accept requests as `user` (it loads the user with User.findByPk)
 * and return the Authorization header to send. Other ids resolve to null.
 */
export const signInAs = (
    sandbox: ReturnType<typeof createSandbox>,
    user: { id: number; email: string; isVerified: boolean },
): string => {
    sandbox.stub(User, 'findByPk', async (id: number) => (Number(id) === user.id ? user : null));
    return `Bearer ${tokens.generateAccessToken({ userId: user.id, email: user.email, isVerified: user.isVerified })}`;
};
