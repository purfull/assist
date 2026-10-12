# Authentication Service

Complete authentication microservice with email/password, OTP verification, Google OAuth, and password reset functionality.

## Features

- ✅ Email/Password signup and signin
- ✅ OTP email verification via Mailgun
- ✅ Google OAuth integration
- ✅ Forgot password flow
- ✅ JWT-based authentication (access + refresh tokens)
- ✅ Redis for OTP storage with auto-expiration
- ✅ Rate limiting for security
- ✅ Input validation
- ✅ Password hashing with bcrypt

## Setup

### 1. Install Dependencies

```bash
cd backend-services/services/auth-service
npm install
```

### 2. Configure Environment

Create a `.env` file based on `.env.example`:

```bash
cp .env.example .env
```

Update the following values:
- Database credentials (MySQL)
- Redis connection details
- Mailgun API key and domain
- Google OAuth credentials
- JWT secrets

### 3. Start MySQL and Redis

Ensure MySQL and Redis are running:

```bash
# MySQL (default port 3306)
# Redis (default port 6379)
```

### 4. Run the Service

Development mode:
```bash
npm run dev
```

Production mode:
```bash
npm start
```

The service will run on port **8001** by default.

## API Endpoints

See [API Documentation](./api_docs.md) for detailed endpoint information.

### Quick Reference

- `POST /auth/signup` - Register new user
- `POST /auth/verify-otp` - Verify email with OTP
- `POST /auth/resend-otp` - Resend OTP
- `POST /auth/signin` - Login
- `POST /auth/forgot-password` - Request password reset
- `POST /auth/reset-password` - Reset password
- `POST /auth/refresh-token` - Refresh access token
- `POST /auth/logout` - Logout
- `GET /auth/google` - Google OAuth
- `GET /auth/me` - Get current user (protected)

## Database Schema

### Users Table
```sql
- id (INT, PRIMARY KEY, AUTO_INCREMENT)
- email (VARCHAR, UNIQUE, NOT NULL)
- password (VARCHAR, NULLABLE)
- googleId (VARCHAR, UNIQUE, NULLABLE)
- isVerified (BOOLEAN, DEFAULT FALSE)
- createdAt (TIMESTAMP)
- updatedAt (TIMESTAMP)
```

### RefreshTokens Table
```sql
- id (INT, PRIMARY KEY, AUTO_INCREMENT)
- userId (INT, FOREIGN KEY)
- token (VARCHAR(500), UNIQUE, NOT NULL)
- expiresAt (TIMESTAMP, NOT NULL)
- createdAt (TIMESTAMP)
- updatedAt (TIMESTAMP)
```

### Redis Storage
- OTPs stored with key format: `otp:{email}`
- Auto-expiration: 5 minutes

## Security Features

- **Password Requirements**: Minimum 8 characters, must contain uppercase, lowercase, and number
- **JWT Tokens**: 
  - Access token: 15 minutes expiry
  - Refresh token: 7 days expiry
- **Rate Limiting**:
  - Auth endpoints: 5 requests per 15 minutes
  - OTP endpoints: 3 requests per 5 minutes
- **OTP**: 6-digit code, 5 minutes expiry
- **Password Hashing**: bcrypt with 10 rounds

## Testing

Use tools like Postman or curl to test the endpoints:

```bash
# Signup
curl -X POST http://localhost:5001/auth/signup \
  -H "Content-Type: application/json" \
  -d '{"email":"test@example.com","password":"SecurePass123"}'

# Verify OTP
curl -X POST http://localhost:8001/auth/verify-otp \
  -H "Content-Type: application/json" \
  -d '{"email":"test@example.com","otp":"123456"}'
```

## Troubleshooting

### Database Connection Issues
- Verify MySQL is running
- Check database credentials in `.env`
- Ensure database exists

### Redis Connection Issues
- Verify Redis is running
- Check Redis connection details in `.env`

### Email Not Sending
- Verify Mailgun API key and domain
- Check Mailgun dashboard for errors
- Ensure `MAILGUN_FROM_EMAIL` is authorized

### Google OAuth Issues
- Verify Google OAuth credentials
- Check callback URL matches Google Console settings
- Ensure frontend URL is correct
