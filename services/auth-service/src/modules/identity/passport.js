const passport = require('passport');
const GoogleStrategy = require('passport-google-oauth20').Strategy;
const User = require('./models/User');

passport.use(
    new GoogleStrategy(
        {
            clientID: process.env.GOOGLE_CLIENT_ID,
            clientSecret: process.env.GOOGLE_CLIENT_SECRET,
            callbackURL: process.env.GOOGLE_CALLBACK_URL
        },
        async (accessToken, refreshToken, profile, done) => {
            try {
                // Check if user exists
                let user = await User.findOne({ where: { googleId: profile.id } });

                if (user) {
                    return done(null, user);
                }

                // Check if email already exists
                user = await User.findOne({ where: { email: profile.emails[0].value } });

                if (user) {
                    // Link Google account to existing user
                    user.googleId = profile.id;
                    user.isVerified = true;
                    await user.save();
                    return done(null, user);
                }

                // Create new user
                user = await User.create({
                    email: profile.emails[0].value,
                    googleId: profile.id,
                    isVerified: true,
                    password: null // No password for OAuth users
                });

                done(null, user);
            } catch (error) {
                done(error, null);
            }
        }
    )
);

passport.serializeUser((user, done) => {
    done(null, user.id);
});

passport.deserializeUser(async (id, done) => {
    try {
        const user = await User.findByPk(id);
        done(null, user);
    } catch (error) {
        done(error, null);
    }
});

module.exports = passport;
