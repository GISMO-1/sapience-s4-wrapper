FROM node:20-alpine AS builder
WORKDIR /app
RUN corepack enable
COPY package.json pnpm-lock.yaml* ./
RUN pnpm install --frozen-lockfile=false
COPY tsconfig.json vite.config.ts index.html ./
COPY src ./src
RUN pnpm run build

FROM node:20-alpine
WORKDIR /app
RUN corepack enable
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/node_modules ./node_modules
COPY package.json ./
EXPOSE 5173
CMD ["pnpm", "preview", "--host", "0.0.0.0", "--port", "5173"]
