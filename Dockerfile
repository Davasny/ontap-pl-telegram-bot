FROM node:18-alpine

RUN npm install -g pnpm@9
WORKDIR /app

COPY package.json pnpm-lock.yaml ./
RUN pnpm install

COPY . .
RUN pnpm test
RUN pnpm build

CMD ["pnpm", "telegram:prod"]
