/** The authenticated user attached to req.user (by JWT auth or the Google strategy). */
export interface AuthUser {
    userId: number;
    email: string;
    isVerified: boolean;
}

declare global {
    // eslint-disable-next-line @typescript-eslint/no-namespace
    namespace Express {
        // eslint-disable-next-line @typescript-eslint/no-empty-object-type
        interface User extends AuthUser {}
        interface Request {
            user?: User | undefined;
        }
    }
}
