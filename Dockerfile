FROM node:22-slim
WORKDIR /app
ENV NODE_ENV=production PASTA_DADOS=/data PORT=3000
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY . .
RUN mkdir -p /data && chown node:node /data
USER node
VOLUME /data
EXPOSE 3000
CMD ["npm", "start"]
