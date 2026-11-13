# syntax=docker/dockerfile:1
FROM node:24-alpine

COPY --from=ghcr.io/pnpm/pnpm:12-alpine /opt/pnpm /opt/pnpm
RUN for bin in pnpm pn pnpx pnx; do ln -s "/opt/pnpm/$bin" "/usr/local/bin/$bin"; done

WORKDIR /app

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm install

COPY . .
RUN --mount=type=secret,id=ONTAP_API_KEY,env=ONTAP_API_KEY,required=true pnpm test
RUN pnpm build

CMD ["pnpm", "telegram:prod"]
