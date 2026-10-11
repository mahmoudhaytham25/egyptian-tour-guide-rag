# ---- Build stage ----
FROM node:24-alpine AS build

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY . .

# Vite inlines this at build time (see src/services/api.js). "/api" makes
# the browser call the API same-origin — the serve-stage nginx proxies it
# to the backend container, so no cross-origin config is needed anywhere.
ARG VITE_API_URL=/api
ENV VITE_API_URL=$VITE_API_URL

RUN npm run build

# ---- Serve stage ----
# Unprivileged nginx listens on 8080 (compose maps 3000:8080). The config
# is fully static and used as-is — it also reverse-proxies /api to the
# backend service (see nginx.conf).
FROM nginxinc/nginx-unprivileged:alpine

COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/dist /usr/share/nginx/html

EXPOSE 8080

CMD ["nginx", "-g", "daemon off;"]
