# AI Search Backend Services

This directory contains the microservices for the AI Search platform.

## Services

- **Gateway**: Entry point for all requests (Port 8000)
- **Auth Service**: User authentication and authorization (Port 8001)
- **Catalog Service**: Product management (Port 8002)
- **Search Service**: AI-powered search (Port 8003)
- **Analytics Service**: Usage statistics (Port 8004)

## Prerequisites

- [Node.js](https://nodejs.org/) (v16+)
- [MySQL](https://www.mysql.com/)
- [Redis](https://redis.io/)
- [RabbitMQ](https://www.rabbitmq.com/) (Required for Catalog Service)

## Getting Started

1. **Install Dependencies**:
   Run the following command in this directory:
   ```bash
   npm install
   ```

2. **Configure Environment Variables**:
   Each service has a `.env.example` file. Create a `.env` file in each service directory and fill in your credentials.
   - `services/auth-service/.env`
   - `services/catalog-service/.env`
   - ... and so on.

3. **Run the Services**:
   You can start all services in development mode with a single command:
   ```bash
   npm run dev:all
   ```

   To start them in production mode:
   ```bash
   npm run start:all
   ```

## API Documentation

The Gateway routes requests to individual services:
- `/auth/*` -> Auth Service
- `/products/*` -> Catalog Service
- `/search/*` -> Search Service
- `/stats/*` -> Analytics Service
# search-agent-api
