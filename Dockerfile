FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY tsconfig*.json vite.config.ts index.html ./
COPY src ./src
RUN npm run build

FROM node:22-alpine
ARG FAMILY_HQ_REVISION=development
ENV FAMILY_HQ_REVISION=$FAMILY_HQ_REVISION
ENV NODE_ENV=production FAMILY_HQ_PORT=3080 HOST=0.0.0.0
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --no-audit --no-fund \
    && npm cache clean --force \
    && rm -rf /usr/local/lib/node_modules/npm /usr/local/bin/npm /usr/local/bin/npx \
    && mkdir -p /app/data && chown node:node /app/data
COPY --from=build /app/dist ./dist
USER node
EXPOSE 3080
CMD ["node", "dist/server/server/index.js"]
