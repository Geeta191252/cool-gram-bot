FROM node:20-alpine AS build
WORKDIR /app
COPY bot/package.json ./
RUN npm install
COPY bot/tsconfig.json ./
COPY bot/src ./src
RUN npm run build

FROM node:20-alpine
WORKDIR /app
ENV NODE_ENV=production
COPY bot/package.json ./
RUN npm install --omit=dev
COPY --from=build /app/dist ./dist
EXPOSE 8000
CMD ["node", "dist/index.js"]
