FROM jrottenberg/ffmpeg:8.0-ubuntu24

# Installer Node.js runtime
RUN apt-get update && apt-get install -y curl python3 python3-requests \
    && curl -fsSL https://deb.nodesource.com/setup_20.x | bash - \
    && apt-get install -y nodejs

# Crée le dossier de l'app
WORKDIR /app
COPY package*.json ./
RUN npm install --production
COPY . .

# Port de l'API
ENV PORT=8001
EXPOSE 8001

# Lancement de ton serveur Node
CMD ["npm", "start"]
