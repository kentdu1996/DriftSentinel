FROM node:20-bookworm-slim AS base
ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH
RUN corepack enable && corepack prepare pnpm@9.15.9 --activate
WORKDIR /app

FROM base AS deps
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json ./
COPY packages/core/package.json packages/core/package.json
COPY packages/probe/package.json packages/probe/package.json
COPY packages/drift-engine/package.json packages/drift-engine/package.json
COPY packages/router/package.json packages/router/package.json
COPY packages/evomap/package.json packages/evomap/package.json
COPY packages/server/package.json packages/server/package.json
COPY packages/dashboard/package.json packages/dashboard/package.json
COPY packages/cli/package.json packages/cli/package.json
RUN pnpm install --frozen-lockfile

FROM deps AS build
COPY . .
RUN pnpm build

FROM base AS runtime
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY --from=deps /app/packages ./packages
COPY --from=build /app/packages ./packages
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json config.demo.yaml ./
COPY testsets ./testsets
RUN mkdir -p data
ENV DRIFT_DAEMON=0
ENV DRIFT_CONFIG=config.demo.yaml
ENV DRIFT_DB=data/driftsentinel-docker.db
ENV PORT=8787
EXPOSE 8787
CMD ["pnpm", "--filter", "@driftsentinel/server", "start"]
