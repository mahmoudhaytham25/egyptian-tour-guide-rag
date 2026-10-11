# ---- Build stage ----
FROM node:24-alpine AS build

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY . .

# Vite inlines this at build time (see src/services/api.js)
ARG VITE_API_URL=http://localhost:3001/api
ENV VITE_API_URL=$VITE_API_URL

RUN npm run build

# ---- Serve stage ----
# Unprivileged nginx listens on 8080 (compose maps 3000:8080).
FROM nginxinc/nginx-unprivileged:alpine

# Origin the CSP connect-src allows (see default.conf.template). The image's
# docker-entrypoint renders /etc/nginx/templates/*.template via envsubst at
# container start, so this is a RUNTIME setting — set it to the ORIGIN part
# of VITE_API_URL (scheme://host[:port], no /api path) with
# `docker run -e API_CONNECT_SRC=...` or compose `environment:` to point the
# same image at any backend without rebuilding.
ENV API_CONNECT_SRC=http://localhost:3001

COPY default.conf.template /etc/nginx/templates/default.conf.template
COPY --from=build /app/dist /usr/share/nginx/html

EXPOSE 8080

CMD ["nginx", "-g", "daemon off;"]
