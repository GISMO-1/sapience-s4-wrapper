FROM node:20-alpine AS builder
WORKDIR /app
RUN corepack enable
COPY tsconfig.base.json ./tsconfig.base.json
COPY tsconfig.base.json /tsconfig.base.json
COPY interfaces/web-portal ./interfaces/web-portal
WORKDIR /app/interfaces/web-portal
RUN pnpm install --frozen-lockfile=false
RUN pnpm run build

FROM node:20-alpine
WORKDIR /app
RUN corepack enable
COPY --from=builder /app/interfaces/web-portal/dist ./dist
COPY --from=builder /app/interfaces/web-portal/node_modules ./node_modules
COPY --from=builder /app/interfaces/web-portal/package.json ./
EXPOSE 5173
CMD ["pnpm", "preview", "--host", "0.0.0.0", "--port", "5173"]
