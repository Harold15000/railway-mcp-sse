FROM node:20-alpine

RUN apk add --no-cache curl

RUN npm install -g supergateway @jasontanswe/railway-mcp

ENV RAILWAY_API_TOKEN=""
ENV PORT=8080

EXPOSE 8080

# Loop de restart automático — si supergateway crashea, arranca solo
CMD while true; do \
      supergateway --port $PORT --stdio "npx @jasontanswe/railway-mcp" --cors; \
      echo "Supergateway crashed, restarting in 2s..."; \
      sleep 2; \
    done
