FROM node:20-alpine
WORKDIR /app
RUN corepack enable
COPY package.json ./
COPY pnpm-lock.yaml ./
RUN pnpm install --no-frozen-lockfile
COPY . .
RUN pnpm build
EXPOSE 4173
CMD ["pnpm", "exec", "vite", "preview", "--host", "0.0.0.0", "--port", "4173", "--allowed-hosts", "all"]
