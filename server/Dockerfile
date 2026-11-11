# An explicit minor tag and the digest it pointed at on 11 November 2026, so a rebuild never
# moves to different bytes unannounced. Docker builds from the digest; the tag is for the
# reader. Dependabot (.github/dependabot.yml) proposes the new pair when a release comes. Raise
# it on purpose, in both FROM lines and in web/Dockerfile.
FROM node:24.22-alpine@sha256:a34ab6d7f6f4813f4d0c5469d74685604b962fbdbf5793a7bc7b4998ecb867c8 AS build
WORKDIR /app
# `npm ci` against the committed lockfile, so the image is reproducible: plain
# `npm install` re-resolves versions and two builds of one commit can differ.
COPY package.json package-lock.json ./
RUN npm ci
COPY tsconfig.json ./
COPY src ./src
# No source maps: nothing in the image reads them.
RUN npm run build -- --sourceMap false

FROM node:24.22-alpine@sha256:a34ab6d7f6f4813f4d0c5469d74685604b962fbdbf5793a7bc7b4998ecb867c8
WORKDIR /app
ENV NODE_ENV=production
COPY package.json package-lock.json ./
# npm is needed for this step only: the image drops it with npx, yarn and corepack, so a running container cannot install code.
RUN npm ci --omit=dev \
 && npm cache clean --force \
 && rm -rf /usr/local/lib/node_modules/npm /usr/local/lib/node_modules/corepack \
    /usr/local/bin/npm /usr/local/bin/npx /usr/local/bin/corepack /usr/local/bin/yarn /usr/local/bin/yarnpkg /opt/yarn-*
COPY --from=build /app/dist ./dist
# Which build is running, shown by /api/health; compose's build.args fill them.
# After the npm layers, so a new commit does not redo `npm ci`.
ARG BUILD_COMMIT=unknown
ARG BUILD_TIME=unknown
ENV BUILD_COMMIT=$BUILD_COMMIT BUILD_TIME=$BUILD_TIME
# The one place this process may write, a volume in the hosted compose file: the saved
# recipients, the monthly schedule and a record of what was sent (core/state.ts).
RUN mkdir -p /data && chown node:node /data
# The image's own unprivileged user, not root: this process holds both Zabbix tokens
# and the AI key. The root-owned app needs no chown, and it writes nothing but /data.
USER node
EXPOSE 4000
# Exec form, no `npm start` and no shell: SIGTERM reaches node (as PID 1, or from
# compose's init) and index.ts closes on it. A shell or npm in front would swallow it.
CMD ["node", "dist/index.js"]
