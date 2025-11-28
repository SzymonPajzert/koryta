FROM node:24-slim

# Install Java for Firebase Emulators
RUN apt-get update && apt-get install -y openjdk-17-jre-headless && rm -rf /var/lib/apt/lists/*

# Install Firebase CLI
RUN npm install -g firebase-tools

WORKDIR /app

# Copy package files
COPY package*.json ./

# Install dependencies
RUN npm install

# Pre-cache Firebase emulators
RUN firebase setup:emulators:firestore
RUN firebase setup:emulators:database
RUN firebase setup:emulators:ui

# Copy project files
COPY . .

# Copy rules from parent directory (assuming context is frontend, we might need to adjust build context or copy manually before build)
# Since Docker build context is usually the current directory, we can't copy from parent directly unless context is parent.
# But user asked to dockerize "frontend".
# I will assume the rules are already copied by the script or I will copy them in the Dockerfile if they are present.
# Actually, I'll rely on the `cp` command in the `emulators` script, BUT `cp ../` won't work in Docker if `../` is not in context.
# So I must ensure rules are IN the build context.
# I will update the `docker-compose` to mount the rules or copy them.
# For now, let's just copy the current directory.

# Expose ports
# Nuxt
EXPOSE 3000
# Emulator UI
EXPOSE 4000
# Auth
EXPOSE 9099
# Firestore
EXPOSE 8080
# Database
EXPOSE 9000

# Start command
CMD ["npm", "run", "dev:local"]
