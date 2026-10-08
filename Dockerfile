# Dev image: runs the Expo dev server (Metro), which serves the web app and devices on the LAN.
# No --web flag: it tries to open a browser, which does not exist in the container.
FROM node:22-bookworm-slim

# git is used by Expo CLI; procps gives Metro a working `ps`.
RUN apt-get update \
  && apt-get install -y --no-install-recommends git procps ca-certificates \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY . .

ENV EXPO_NO_TELEMETRY=1

EXPOSE 8082

CMD ["npx", "expo", "start", "--host", "lan", "--port", "8082"]
