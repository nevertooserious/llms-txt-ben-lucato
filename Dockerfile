# One image for the web app and the worker; docker-compose.yml picks the command.
FROM node:24-bookworm-slim

WORKDIR /app
ENV PLAYWRIGHT_BROWSERS_PATH=/ms-playwright
ENV NEXT_TELEMETRY_DISABLED=1

# Manifests first, so a source change does not reinstall dependencies. npm ci needs
# every workspace in the lockfile, so a new workspace must be added here too.
COPY package.json package-lock.json ./
COPY apps/web/package.json apps/web/
COPY apps/worker/package.json apps/worker/
COPY e2e/package.json e2e/
COPY packages/contracts/package.json packages/contracts/
COPY packages/crawler/package.json packages/crawler/
COPY packages/db/package.json packages/db/
COPY packages/extractor/package.json packages/extractor/
COPY packages/generator/package.json packages/generator/
COPY packages/monitor/package.json packages/monitor/
COPY packages/runtime/package.json packages/runtime/
RUN npm ci

# Installs the Chromium that matches the playwright version in package-lock.json.
RUN npx playwright install --with-deps chromium

COPY . .
RUN npm run build --workspace @llms-txt/web \
  && chown -R node:node apps/web/.next

USER node
