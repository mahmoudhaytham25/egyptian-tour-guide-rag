FROM node:20-slim

WORKDIR /app

COPY package.json package-lock.json* ./
RUN npm install --omit=dev

COPY . .

EXPOSE 3001

# The entrypoint waits for MongoDB, runs `migrate-mongo up`, then execs CMD.
# Invoked via bash so no exec bit is required on the script in the image.
ENTRYPOINT ["bash", "docker-entrypoint.sh"]
CMD ["node", "server.js"]
