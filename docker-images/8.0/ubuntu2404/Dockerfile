FROM jrottenberg/ffmpeg:7.1.2-ubuntu2404

# Installer Node.js runtime
RUN apt-get update && apt-get install -y curl python3 python3-requests \
    && curl -fsSL https://deb.nodesource.com/setup_20.x | bash - \
    && apt-get install -y nodejs \
    && apt-get clean && rm -rf /var/lib/apt/lists/*

# Crée un utilisateur non-root
RUN useradd -m appuser
USER appuser

# Crée le dossier de l'app
WORKDIR /app
COPY --chown=appuser:appuser package*.json ./
RUN npm install --production
COPY --chown=appuser:appuser . .

# Port de l'API
ENV PORT=8001
EXPOSE 8001

# Points de montage pour persistance
VOLUME ["/data/storage", "/data/temp"]

# Healthcheck pour s'assurer que le serveur tourne
HEALTHCHECK --interval=30s --timeout=5s --start-period=5s \
  CMD curl -f http://localhost:8001/health || exit 1

# Lancement de ton serveur Node
CMD ["npm", "start"]
