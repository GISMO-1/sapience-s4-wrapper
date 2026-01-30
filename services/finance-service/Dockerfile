FROM node:20-alpine AS builder
WORKDIR /app
RUN corepack enable
COPY package.json pnpm-lock.yaml* ./
RUN pnpm install --frozen-lockfile=false
COPY tsconfig.json ../../tsconfig.base.json ./
COPY src ./src
RUN pnpm run build
RUN mkdir -p dist/db/migrations && cp -r src/db/migrations/*.sql dist/db/migrations/

FROM node:20-alpine
WORKDIR /app
ENV NODE_ENV=production
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/node_modules ./node_modules
COPY package.json ./
CMD ["node", "dist/index.js"]
