FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production TZ=Europe/Berlin DATA_DIR=/data PORT=3000
RUN apk add --no-cache tzdata poppler-utils
COPY package*.json ./
RUN npm ci --omit=dev
COPY . .
VOLUME /data
EXPOSE 3000
CMD ["node", "--disable-warning=ExperimentalWarning", "server.js"]
