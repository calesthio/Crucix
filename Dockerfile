FROM node:22-alpine

WORKDIR /app

# Install wget for health check
RUN apk add --no-cache wget

# Copy package files first for better layer caching
COPY package*.json ./
RUN npm install --production

# Copy source
COPY . .

# Create non-root user for security
RUN addgroup -g 1001 crucix &&     adduser -D -u 1001 -G crucix crucix &&     chown -R crucix:crucix /app
USER crucix

# Default port (override with -e PORT=xxxx)
EXPOSE 3117

# Health check
HEALTHCHECK --interval=60s --timeout=10s --retries=3   CMD wget -qO- http://localhost:3117/api/health || exit 1

CMD ["node", "server.mjs"]
