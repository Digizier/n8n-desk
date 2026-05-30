```dockerfile
FROM node:20-alpine

WORKDIR /app

RUN apk add --no-cache git python3 make g++

COPY package*.json ./

RUN npm install

COPY . .

ENV NODE_ENV=production
ENV PORT=3000

RUN npm run build || true

EXPOSE 3000

CMD ["npm","run","dev","--","--host","0.0.0.0","--port","3000"]
```
