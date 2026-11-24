# One image for the API and the worker. The command picks which.
FROM node:24.15.0-alpine
WORKDIR /app
RUN corepack enable
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY packages packages
COPY apps/api apps/api
COPY apps/worker apps/worker
COPY scripts/setup-db.ts scripts/
RUN pnpm install --frozen-lockfile --prod --filter @wavekeep/api... --filter @wavekeep/worker...
USER node
ENV HOST=0.0.0.0
CMD ["node", "apps/api/src/server.ts"]
