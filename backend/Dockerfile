
FROM node:22-alpine AS dependencies
WORKDIR /app

COPY package.json package-lock.json tsconfig.base.json ./
COPY database/package.json database/package.json

RUN npm ci --legacy-peer-deps

FROM dependencies AS build
COPY database database

# Generate Prisma Client and copy it to the location used by the API.
RUN npm run db:generate \
    && mkdir -p /app/node_modules/.prisma/client \
    && cp -R /node_modules/.prisma/client/. /app/node_modules/.prisma/client/

COPY src src
COPY tsconfig.json ./

RUN npm run build

FROM node:22-alpine AS production-dependencies
WORKDIR /app
COPY package.json package-lock.json tsconfig.base.json ./
COPY database database
RUN npm ci --omit=dev --legacy-peer-deps

FROM node:22-alpine AS production
RUN apk add --no-cache poppler-utils tesseract-ocr tesseract-ocr-data-eng
ENV NODE_ENV=production
WORKDIR /app

COPY --from=production-dependencies /app/node_modules ./node_modules
COPY --from=dependencies /app/package.json /app/package-lock.json ./
COPY --from=build /app/database ./database
COPY --from=build /app/package.json /app/tsconfig.json ./
COPY --from=build /app/node_modules/.prisma/client ./node_modules/.prisma/client
COPY --from=build /app/dist ./dist

RUN mkdir -p /app/storage/invoices && chown -R node:node /app

USER node
EXPOSE 4000

HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 CMD node -e "const port=process.env.PORT||4000; fetch(\"http://127.0.0.1:\"+port+\"/api/health\").then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["npm", "run", "start"]
