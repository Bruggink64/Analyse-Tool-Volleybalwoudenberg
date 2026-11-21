FROM node:22-slim

WORKDIR /app

# Install dependencies first for optimal layer caching
COPY package.json package-lock.json* bun.lock* ./
RUN npm install

# Copy application source and build frontend bundle
COPY . .
RUN npm run build

ENV NODE_ENV=production
ENV PORT=3000

EXPOSE 3000

CMD ["npm", "start"]
