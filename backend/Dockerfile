FROM node:22-alpine

ENV NODE_ENV=production
WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --omit=dev
COPY --chown=node:node src ./src
COPY --chown=node:node db ./db

USER node
EXPOSE 8080
CMD ["node", "src/server.js"]
