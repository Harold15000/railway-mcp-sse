FROM node:20-alpine

RUN apk add --no-cache curl

RUN npm install -g @jasontanswe/railway-mcp

WORKDIR /app
COPY server.js .

ENV RAILWAY_API_TOKEN=""
ENV PORT=8080

EXPOSE 8080

CMD ["node", "server.js"]
