# Base FFmpeg
FROM jrottenberg/ffmpeg:7.1.2-ubuntu2404

# Installer Node.js runtime + utilitaires nécessaires
RUN apt-get update && apt-get install -y \
        curl \
        python3 \
        python3-requests \
    && curl -fsSL https://deb.nodesource.com/setup_20.x | bash - \
    && apt-get install -y nodejs \
    && apt-get clean \
    && rm -rf /var/lib/apt/lists/*

# Créer le dossier de l'app
WORKDIR /app

# Copier package.json / package-lock.json et installer dépendances
COPY package*.json ./
RUN npm install --production

# Copier tout le code de l'application
COPY . .

# Créer dossiers de stockage / temp si besoin
RUN mkdir -p /data/storage /data/temp

# Définir le port de l'API
ENV PORT=8001
EXPOSE 8001

# Lancer le serveur Node.js
CMD ["npm", "start"]
