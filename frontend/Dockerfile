# ---- Build stage ----
FROM node:24-alpine AS build

WORKDIR /app

COPY package.json package-lock.json* ./
RUN npm ci

COPY . .

# CRA inlines this at build time (see src/services/api.js)
ARG REACT_APP_API_URL=http://localhost:3001/api
ENV REACT_APP_API_URL=$REACT_APP_API_URL

ENV DISABLE_ESLINT_PLUGIN=true
RUN npm run build

# ---- Serve stage ----
# Unprivileged nginx listens on 8080 (compose maps 3000:8080).
FROM nginxinc/nginx-unprivileged:alpine

COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/build /usr/share/nginx/html

EXPOSE 8080

CMD ["nginx", "-g", "daemon off;"]
