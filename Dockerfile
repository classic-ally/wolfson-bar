# Build stage for frontend
FROM node:20-alpine AS frontend-builder

WORKDIR /app/frontend

# Copy frontend package files
COPY frontend/package.json frontend/pnpm-lock.yaml ./

# Install pnpm and dependencies
RUN npm install -g pnpm && pnpm install --frozen-lockfile

# Copy frontend source
COPY frontend/ ./

# Build frontend
RUN pnpm build

# Build stage for backend
FROM rust:1.89-alpine AS backend-builder

WORKDIR /app/backend

# Install build dependencies
RUN apk add --no-cache musl-dev openssl-dev openssl-libs-static pkgconfig

# Copy backend manifest files
COPY backend/Cargo.toml backend/Cargo.lock ./

# Create dummy main to cache dependencies
RUN mkdir src && \
    echo "fn main() {}" > src/main.rs && \
    cargo build --release && \
    rm -rf src

# Copy backend source
COPY backend/ ./

# Build backend (dependencies already cached)
RUN touch src/main.rs && cargo build --release

# Runtime stage
FROM alpine:latest

WORKDIR /app

# Copy backend binary
COPY --from=backend-builder /app/backend/target/release/wolfson-bar-backend ./backend

# Copy migrations
COPY --from=backend-builder /app/backend/migrations ./migrations

# Copy built frontend
COPY --from=frontend-builder /app/frontend/dist ./frontend/dist

# Expose port
EXPOSE 3000

# Set environment variables
ENV PUBLIC_URL=""
ENV FRONTEND_PATH="./frontend/dist"

# Run backend (will panic if PUBLIC_URL not set)
CMD ["./backend"]
