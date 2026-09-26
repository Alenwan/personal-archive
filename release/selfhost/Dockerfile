FROM node:24.19.0-bookworm-slim@sha256:a9f5f7c91a432850b2a8a7797adf5eadb6c733ceed61167806cee7ea7fbc29df AS builder
WORKDIR /app
RUN npm install --global npm@12.0.2 --ignore-scripts --no-audit --no-fund
COPY package.json package-lock.json ./
RUN npm ci --ignore-scripts --no-audit --no-fund
COPY src ./src
COPY functions ./functions
COPY server ./server
COPY migrations ./migrations
COPY scripts/build-selfhost.mjs scripts/migrate.mjs scripts/init-admin.mjs scripts/set-user-password.mjs scripts/claim-manuscript-key-owner.mjs ./scripts/
COPY scripts/bundleNotices.mjs scripts/bundleNotices.d.mts ./scripts/
COPY release/licenses ./release/licenses
COPY public ./public
COPY tsconfig.json tsconfig.node.json env.d.ts vite.config.ts tailwind.config.ts postcss.config.js index.html ./
ENV VITE_BUSINESS_TEMPLATE=personal-archive
RUN npm run build:docker

FROM node:24.19.0-bookworm-slim@sha256:a9f5f7c91a432850b2a8a7797adf5eadb6c733ceed61167806cee7ea7fbc29df AS runtime
ENV NODE_ENV=production APP_ENV=production BUSINESS_TEMPLATE=personal-archive \
    DEMO_MODE=false PBX_AMI_ENABLED=false HOST=0.0.0.0 PORT=8080 STATIC_ROOT=/app/dist
WORKDIR /app
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/dist-server ./dist-server
COPY --from=builder /app/migrations ./migrations
USER node
EXPOSE 8080
CMD ["node", "dist-server/selfhost.mjs"]
