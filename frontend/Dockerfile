# ---- Build stage ----
FROM node:20-alpine AS build

WORKDIR /app

COPY package.json package-lock.json* ./
RUN npm install

COPY . .

# CRA inlines this at build time (see src/services/api.js)
ARG REACT_APP_API_URL=http://localhost:3001/api
ENV REACT_APP_API_URL=$REACT_APP_API_URL

ENV DISABLE_ESLINT_PLUGIN=true
RUN npm run build

# ---- Serve stage ----
FROM nginx:alpine

COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/build /usr/share/nginx/html

EXPOSE 80

CMD ["nginx", "-g", "daemon off;"]
