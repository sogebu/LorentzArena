FROM node:20-alpine

WORKDIR /app

COPY relay-server/package.json ./package.json
RUN npm install --omit=dev

COPY relay-server/server.mjs ./server.mjs

ENV PORT=8787
EXPOSE 8787

CMD ["node", "server.mjs"]
