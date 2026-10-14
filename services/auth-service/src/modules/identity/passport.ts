import passport from 'passport';
import { Strategy as GoogleStrategy } from 'passport-google-oauth20';
import User from './models/User';
import type { AuthUser } from './types';

/**
 * Google OAuth. The strategy finds or creates the user and hands the route an AuthUser,
 * the same shape JWT authentication produces. Sessions are not used (session: false).
 */
passport.use(
    new GoogleStrategy(
        {
            clientID: process.env.GOOGLE_CLIENT_ID ?? '',
            clientSecret: process.env.GOOGLE_CLIENT_SECRET ?? '',
            callbackURL: process.env.GOOGLE_CALLBACK_URL ?? '',
        },
        async (_accessToken, _refreshToken, profile, done) => {
            try {
                const email = profile.emails?.[0]?.value;
                const toAuthUser = (user: User): AuthUser =>
                    ({ userId: user.id, email: user.email, isVerified: user.isVerified });

                // Existing Google-linked user
                let user = await User.findOne({ where: { googleId: profile.id } });
                if (user) {
                    done(null, toAuthUser(user));
                    return;
                }

                if (!email) {
                    // Google accounts without a verified email can't be linked or created
                    done(null, false);
                    return;
                }

                // Link Google account to an existing email/password user
                user = await User.findOne({ where: { email } });
                if (user) {
                    user.googleId = profile.id;
                    user.isVerified = true;
                    await user.save();
                    done(null, toAuthUser(user));
                    return;
                }

                // Create new user (no password for OAuth users)
                user = await User.create({ email, googleId: profile.id, isVerified: true, password: null });
                done(null, toAuthUser(user));
            } catch (error) {
                done(error);
            }
        },
    ),
);

export default passport;
