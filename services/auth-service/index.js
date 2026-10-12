require('dotenv').config();
const express = require('express');
const cors = require('cors');
const cookieParser = require('cookie-parser');
const passport = require('./src/config/passport');
const { connectDB } = require('./src/config/database');
const redis = require('./src/config/redis');
const authRoutes = require('./src/routes/authRoutes');
const paymentRoutes = require('./src/routes/paymentRoutes');
const ticketRoutes = require('./src/routes/ticketRoutes');
const { generalLimiter } = require('./src/middleware/rateLimiter');

const app = express();
const PORT = process.env.PORT || 5001;

// Middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());
const allowedOrigins = (process.env.ALLOWED_ORIGINS || process.env.FRONTEND_URL || 'http://localhost:3000').split(',').map(origin => origin.trim());

app.use(cors({
    origin: allowedOrigins,
    credentials: true,
  allowedHeaders: ["Content-Type", "Authorization"],
}));
app.use(generalLimiter);

// Passport initialization
app.use(passport.initialize());

// Health check
app.get('/health', (req, res) => res.json({
    service: 'Auth Service',
    status: 'active',
    timestamp: new Date().toISOString()
}));

// Routes
app.use('/auth', authRoutes);
app.use('/auth/payment', paymentRoutes);
app.use('/tickets', ticketRoutes);

// 404 handler
app.use((req, res) => {
    res.status(404).json({ error: 'Route not found' });
});

// Error handler
app.use((err, req, res, next) => {
    console.error('Error:', err);
    res.status(err.status || 500).json({
        error: err.message || 'Internal server error'
    });
});

// Start server
const startServer = async () => {
    try {
        // Connect to database
        await connectDB();

        // Test Redis connection
        await redis.ping();

        // Start listening
        app.listen(PORT, () => {
            console.log(`\n✓ Auth Service running on port ${PORT}`);
            console.log(`✓ Environment: ${process.env.NODE_ENV || 'development'}`);
            console.log(`✓ Frontend URL: ${process.env.FRONTEND_URL || 'http://localhost:3000'}\n`);
        });
    } catch (error) {
        console.error('Failed to start server:', error);
        process.exit(1);
    }
};

startServer();
