FROM node:20-alpine AS builder
WORKDIR /app
RUN corepack enable
COPY interfaces/api-gateway/package.json pnpm-lock.yaml* ./
RUN pnpm install --frozen-lockfile=false
COPY interfaces/api-gateway/tsconfig.json tsconfig.base.json ./
COPY tsconfig.base.json /tsconfig.base.json
COPY interfaces/api-gateway/src ./src
RUN pnpm run build

FROM node:20-alpine
WORKDIR /app
ENV NODE_ENV=production
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/node_modules ./node_modules
COPY interfaces/api-gateway/package.json ./
CMD ["node", "dist/index.js"]
