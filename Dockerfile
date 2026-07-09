# Multi-stage build for the Next.js standalone output (docs/ARCHITECTURE.md §8)
FROM node:22-slim AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

FROM node:22-slim AS build
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN rm -rf legacy && npm run build

FROM node:22-slim AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV DATA_DIR=/data
RUN mkdir -p /data && chown node:node /data
USER node
COPY --from=build --chown=node:node /app/.next/standalone ./
COPY --from=build --chown=node:node /app/.next/static ./.next/static
COPY --from=build --chown=node:node /app/public ./public
EXPOSE 3000
VOLUME ["/data"]
CMD ["node", "server.js"]
