require('dotenv').config();
const express = require('express');
const cors = require('cors');
const rateLimit = require('express-rate-limit');
const { connectDB } = require('./src/config/database');
const FileRecord = require('./src/models/FileRecord');
const fileRoutes = require('./src/routes/fileRoutes');

const app = express();
const PORT = process.env.PORT || 5005;

// ─────────────────────────────────────────────────────────────────────────────
// CORS
// ─────────────────────────────────────────────────────────────────────────────
const allowedOrigins = (
    process.env.ALLOWED_ORIGINS || 'http://localhost:3000,http://localhost:5173'
)
    .split(',')
    .map((o) => o.trim());

app.use(
    cors({
        origin: allowedOrigins,
        credentials: true,
        allowedHeaders: ['Content-Type', 'Authorization'],
    })
);

// ─────────────────────────────────────────────────────────────────────────────
// Body parsing
// ─────────────────────────────────────────────────────────────────────────────
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// ─────────────────────────────────────────────────────────────────────────────
// Rate limiting
// ─────────────────────────────────────────────────────────────────────────────
const generalLimiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 200,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: 'Too many requests, please try again later.' },
});

const uploadLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 50, // stricter limit for upload endpoints
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: 'Upload rate limit exceeded, please try again later.' },
});

app.use(generalLimiter);

// ─────────────────────────────────────────────────────────────────────────────
// Health check
// ─────────────────────────────────────────────────────────────────────────────
app.get('/health', (req, res) =>
    res.json({
        service: 'File Upload Service',
        status: 'active',
        timestamp: new Date().toISOString(),
    })
);

// ─────────────────────────────────────────────────────────────────────────────
// Routes
// ─────────────────────────────────────────────────────────────────────────────
// Apply upload rate limiter only to POST/PUT on /files
app.use('/files/upload', uploadLimiter);
app.use('/files', fileRoutes);

// ─────────────────────────────────────────────────────────────────────────────
// Multer error handler (must come after routes)
// ─────────────────────────────────────────────────────────────────────────────
app.use((err, req, res, next) => {
    if (err.code === 'LIMIT_FILE_SIZE') {
        const maxMb = process.env.MAX_FILE_SIZE_MB || 10;
        return res.status(413).json({
            error: `File too large. Maximum allowed size is ${maxMb} MB.`,
        });
    }
    if (err.code === 'LIMIT_FILE_COUNT') {
        return res.status(400).json({ error: 'Too many files. Maximum 10 files per request.' });
    }
    if (err.code === 'LIMIT_UNEXPECTED_FILE') {
        return res.status(415).json({ error: err.message || 'Unsupported file type.' });
    }
    // Generic error
    console.error('[Error]', err);
    res.status(err.status || 500).json({ error: err.message || 'Internal server error' });
});

// ─────────────────────────────────────────────────────────────────────────────
// 404
// ─────────────────────────────────────────────────────────────────────────────
app.use((req, res) => res.status(404).json({ error: 'Route not found' }));

// ─────────────────────────────────────────────────────────────────────────────
// Bootstrap
// ─────────────────────────────────────────────────────────────────────────────
const startServer = async () => {
    try {
        await connectDB();

        // Sync FileRecord table
        await FileRecord.sync({ alter: false });
        console.log('✓ file_records table ready');

        app.listen(PORT, () => {
            console.log(`\n✓ File Upload Service running on port ${PORT}`);
            console.log(`✓ Environment: ${process.env.NODE_ENV || 'development'}`);
            console.log(`✓ Upload directory: ${process.env.UPLOAD_DIR || 'uploads'}\n`);
        });
    } catch (error) {
        console.error('Failed to start server:', error);
        process.exit(1);
    }
};

startServer();
