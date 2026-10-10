# Egyptian History RAG backend — Express API
FROM node:24-slim

WORKDIR /app

# Install production dependencies first for better layer caching.
# package-lock.json is committed, so `npm ci` gives a reproducible install.
COPY --chown=node:node package.json package-lock.json ./

RUN npm ci --omit=dev

# App source (node_modules, .env, tests etc. are excluded via .dockerignore)
COPY --chown=node:node . .

ENV NODE_ENV=production

EXPOSE 3001

# Run as the node image's built-in non-root user. Uploaded PDFs land on the
# shared `rag-data` volume mounted at /model-server/data (see docker-compose).
USER node

# The entrypoint waits for MongoDB, runs `migrate-mongo up`, then execs CMD.
# Invoked via bash so no exec bit is required on the script in the image.
ENTRYPOINT ["bash", "docker-entrypoint.sh"]
CMD ["node", "server.js"]
