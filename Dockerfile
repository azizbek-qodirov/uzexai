FROM node:24-bookworm-slim

# Python refreshes public UZEX weekly quotes; Node runs SQLite and the app.
RUN apt-get update && apt-get install -y --no-install-recommends python3 ca-certificates \
    && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts && npm cache clean --force
COPY --chown=node:node . .
RUN mkdir -p /app/data /app/data/quotes /app/storage && chown -R node:node /app/data /app/storage
USER node
ENV NODE_ENV=production HOST=0.0.0.0 PORT=3000 PYTHON_BIN=python3 DATABASE_PATH=/app/storage/uzex.sqlite
EXPOSE 3000
CMD ["node", "scripts/start-container.mjs"]
