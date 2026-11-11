# Explicit minor tags and digests, as in server/Dockerfile: keep the Node one the same.
FROM node:24.22-alpine@sha256:a34ab6d7f6f4813f4d0c5469d74685604b962fbdbf5793a7bc7b4998ecb867c8 AS build
WORKDIR /app
# Copy the lockfile too and use `npm ci`: `npm install` resolves fresh versions
# at build time, so two builds of the same commit can ship different code.
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build

# The unprivileged build runs as uid 101, not root, and so cannot bind port 80:
# it listens on 8080 (nginx.conf). Its pid file and temp files go under /tmp.
FROM nginxinc/nginx-unprivileged:1.30-alpine@sha256:f5116ed4606f3eb015dd4a8e28cb9b351476dc0ad4bc6e9f93b19cec130cdf03
COPY nginx.conf /etc/nginx/conf.d/default.conf
# Proxy settings shared by the /bff locations. Not *.conf, so nginx loads it only where included.
COPY bff-proxy.inc /etc/nginx/conf.d/bff-proxy.inc
COPY --from=build /app/dist /usr/share/nginx/html
EXPOSE 8080
