########################################
# Stage 1: Build FFmpeg
########################################
FROM ubuntu:24.04 AS builder

ENV FFMPEG_VERSION=8.0
ENV PREFIX=/opt/ffmpeg
ENV LD_LIBRARY_PATH=/opt/ffmpeg/lib:/opt/ffmpeg/lib64

# Dépendances build
RUN apt-get -yqq update && \
    apt-get install -yq --no-install-recommends \
    build-essential git curl wget yasm pkg-config libx264-dev libx265-dev \
    libfdk-aac-dev libvpx-dev libopus-dev libmp3lame-dev libass-dev libfreetype6-dev \
    python3 python3-requests

WORKDIR /tmp/ffmpeg
COPY build_source.sh install_ffmpeg.sh ./

# Compile FFmpeg
RUN ./build_source.sh && ./install_ffmpeg.sh

########################################
# Stage 2: Node + FFmpeg runtime
########################################
FROM node:20-bullseye

# Copie FFmpeg depuis le builder
COPY --from=builder /opt/ffmpeg /opt/ffmpeg
ENV PATH="/opt/ffmpeg/bin:$PATH"
ENV LD_LIBRARY_PATH="/opt/ffmpeg/lib:/opt/ffmpeg/lib64"

# Crée le dossier de l'app
WORKDIR /app
COPY package*.json ./
RUN npm install --production
COPY . .

# Définition du port de l'API
ENV PORT=8001
EXPOSE 8001

# Lancement automatique de ton serveur Node
CMD ["npm", "start"]
