FROM node:22-bookworm-slim
WORKDIR /app
COPY package.json ./
COPY src ./src
COPY test ./test
# Generate the reference data at build time.
RUN node scripts/build-reference.js
ENV PORT=8080
EXPOSE 8080
CMD ["node", "src/server.js"]
