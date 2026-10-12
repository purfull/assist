require('dotenv').config();
const express = require('express');
const { createProxyMiddleware } = require('http-proxy-middleware');
const cors = require('cors');

const app = express();
const PORT = process.env.PORT || 5000;

const allowedOrigins = (process.env.ALLOWED_ORIGINS || process.env.FRONTEND_URL || 'http://localhost:3000,http://localhost:3001,http://localhost:5173').split(',').map(origin => origin.trim());

app.use(cors({
    origin: allowedOrigins,
    credentials: true
}));

// Health Check
app.get('/health', (req, res) => res.json({ status: 'Gateway is running' }));

// Service Route Configs (To be updated with actual service URLs)
const SERVICES = {
    AUTH: process.env.AUTH_SERVICE_URL || 'http://localhost:5001',
    FILE_UPLOAD: process.env.FILE_UPLOAD_SERVICE_URL || 'http://localhost:5005',
};

// Proxies
app.use(createProxyMiddleware('/auth', { target: SERVICES.AUTH, changeOrigin: true }));
app.use(createProxyMiddleware('/files', { target: SERVICES.FILE_UPLOAD, changeOrigin: true }));

app.listen(PORT, () => {
    console.log(`API Gateway running on port ${PORT}`);
});
