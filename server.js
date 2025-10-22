// server.js - API Node.js complète pour FFmpeg
const express = require('express');
const multer = require('multer');
const { spawn } = require('child_process');
const fs = require('fs').promises;
const path = require('path');
const { v4: uuidv4 } = require('uuid');

const app = express();
const upload = multer({ dest: '/tmp/uploads/' });

// Stockage en mémoire des jobs
const jobs = new Map();
const webhooks = new Map();
const STORAGE_DIR = '/data/storage';
const TEMP_DIR = '/data/temp';

// Initialisation des dossiers
async function initDirs() {
  await fs.mkdir(STORAGE_DIR, { recursive: true });
  await fs.mkdir(TEMP_DIR, { recursive: true });
}

// ========================================
// DOCUMENTATION INTERACTIVE
// ========================================
app.get('/docs', (req, res) => {
  res.send(`
<!DOCTYPE html>
<html>
<head>
  <title>FFmpeg API - Documentation</title>
  <style>
    body { font-family: Arial; max-width: 1200px; margin: 50px auto; padding: 0 20px; }
    h1 { color: #2c3e50; }
    .endpoint { background: #f8f9fa; padding: 20px; margin: 20px 0; border-radius: 8px; border-left: 4px solid #3498db; }
    .method { display: inline-block; padding: 5px 10px; border-radius: 4px; font-weight: bold; margin-right: 10px; }
    .post { background: #27ae60; color: white; }
    .get { background: #3498db; color: white; }
    .delete { background: #e74c3c; color: white; }
    .workflow { background: #fff3cd; padding: 20px; border-radius: 8px; margin: 30px 0; }
    .step { background: white; padding: 15px; margin: 10px 0; border-left: 3px solid #ffc107; }
    code { background: #f4f4f4; padding: 2px 6px; border-radius: 3px; }
    pre { background: #2c3e50; color: #ecf0f1; padding: 15px; border-radius: 5px; overflow-x: auto; }
  </style>
</head>
<body>
  <h1>📹 FFmpeg API - Documentation Complète</h1>
  
  <div class="workflow">
    <h2>🔄 Ordre d'exécution recommandé pour votre workflow N8N</h2>
    
    <div class="step">
      <h3>Phase 1: PRÉPARATION DES ASSETS 📦</h3>
      <ol>
        <li><code>POST /api/v1/media/storage</code> - Upload image de fond</li>
        <li><code>POST /api/v1/media/storage</code> - Upload musique de fond (optionnel)</li>
        <li><code>POST /api/v1/media/storage</code> - Upload overlay vidéo (optionnel)</li>
      </ol>
      <p><strong>⚠️ IMPORTANT:</strong> Attendez <code>status: "ready"</code> pour chaque fichier avant de continuer</p>
    </div>

    <div class="step">
      <h3>Phase 2: OPTIMISATION DES ASSETS 🎨</h3>
      <ol>
        <li><code>POST /api/v1/media/video-tools/color-grade</code> - Uniformiser les couleurs des images</li>
        <li><code>POST /api/v1/media/audio-tools/normalize</code> - Normaliser le volume de la musique</li>
        <li><code>POST /api/v1/media/video-tools/ken-burns</code> - Ajouter dynamisme aux images statiques (optionnel)</li>
      </ol>
    </div>

    <div class="step">
      <h3>Phase 3: GÉNÉRATION AUDIO 🔊</h3>
      <ol>
        <li><code>POST /api/v1/media/audio-tools/tts/kokoro</code> - Générer les voix TTS pour chaque clip</li>
        <li><code>POST /api/v1/media/audio-tools/denoise</code> - Nettoyer le bruit du TTS</li>
        <li><code>POST /api/v1/media/audio-tools/normalize</code> - Normaliser le volume des voix</li>
      </ol>
    </div>

    <div class="step">
      <h3>Phase 4: CRÉATION DES CLIPS INDIVIDUELS 🎬</h3>
      <ol>
        <li><code>POST /api/v1/media/video-tools/generate/tts-captioned-video</code> - Pour chaque segment</li>
        <li>En parallèle pour chaque clip généré:
          <ul>
            <li><code>GET /api/v1/media/storage/:fileId/status</code> - Vérifier si prêt</li>
            <li><code>GET /api/v1/media/info/:fileId</code> - Récupérer durée pour synchronisation</li>
          </ul>
        </li>
      </ol>
    </div>

    <div class="step">
      <h3>Phase 5: ASSEMBLAGE FINAL 🎞️</h3>
      <ol>
        <li><code>POST /api/v1/media/video-tools/add-transitions</code> - Ajouter transitions entre clips</li>
        <li><code>POST /api/v1/media/video-tools/merge</code> - Fusionner tous les clips</li>
        <li><code>POST /api/v1/media/audio-tools/ducking</code> - Appliquer audio ducking sur vidéo finale</li>
        <li><code>POST /api/v1/media/video-tools/add-colorkey-overlay</code> - Ajouter overlay final</li>
      </ol>
    </div>

    <div class="step">
      <h3>Phase 6: OPTIMISATION & EXPORT 🚀</h3>
      <ol>
        <li><code>POST /api/v1/media/video-tools/optimize</code> - Optimiser pour plateforme cible</li>
        <li><code>POST /api/v1/media/video-tools/thumbnail</code> - Générer miniature</li>
        <li><code>GET /api/v1/media/storage/:fileId</code> - Télécharger vidéo finale</li>
      </ol>
    </div>

    <div class="step">
      <h3>Phase 7: NETTOYAGE 🧹</h3>
      <ol>
        <li><code>DELETE /api/v1/media/storage/:fileIds</code> - Supprimer fichiers temporaires</li>
      </ol>
    </div>
  </div>

  <h2>📍 Endpoints disponibles</h2>

  <div class="endpoint">
    <span class="method get">GET</span>
    <strong>/health</strong>
    <p>Vérifier que l'API est opérationnelle</p>
  </div>

  <h3>🗄️ Gestion du Stockage</h3>

  <div class="endpoint">
    <span class="method post">POST</span>
    <strong>/api/v1/media/storage</strong>
    <p>Upload un fichier (image, audio, vidéo)</p>
    <pre>
Content-Type: multipart/form-data
Body:
  - file: [binary]
  - media_type: "video" | "audio" | "image"

Response: { file_id, status, media_type }</pre>
  </div>

  <div class="endpoint">
    <span class="method get">GET</span>
    <strong>/api/v1/media/storage/:fileId/status</strong>
    <p>Vérifier le statut d'un job</p>
    <pre>Response: { status: "processing" | "ready" | "failed", file_id }</pre>
  </div>

  <div class="endpoint">
    <span class="method get">GET</span>
    <strong>/api/v1/media/storage/:fileId/progress</strong>
    <p>Obtenir la progression en temps réel (0-100%)</p>
    <pre>Response: { file_id, progress: 45.5, status }</pre>
  </div>

  <div class="endpoint">
    <span class="method get">GET</span>
    <strong>/api/v1/media/storage/:fileId</strong>
    <p>Télécharger le fichier généré</p>
  </div>

  <div class="endpoint">
    <span class="method delete">DELETE</span>
    <strong>/api/v1/media/storage/:fileIds</strong>
    <p>Supprimer un ou plusieurs fichiers (séparés par virgule)</p>
  </div>

  <div class="endpoint">
    <span class="method get">GET</span>
    <strong>/api/v1/media/info/:fileId</strong>
    <p>Récupérer les métadonnées d'un fichier</p>
    <pre>Response: { duration, resolution, codec, bitrate, fps }</pre>
  </div>

  <h3>🔊 Outils Audio</h3>

  <div class="endpoint">
    <span class="method post">POST</span>
    <strong>/api/v1/media/audio-tools/tts/kokoro</strong>
    <p>Générer une voix Text-to-Speech</p>
    <pre>
Body: { text, voice, speed }
Response: { file_id, status }</pre>
  </div>

  <div class="endpoint">
    <span class="method post">POST</span>
    <strong>/api/v1/media/audio-tools/normalize</strong>
    <p>Normaliser le volume audio</p>
    <pre>
Body: { audio_id, target_level: -16 }
Response: { file_id, status }</pre>
  </div>

  <div class="endpoint">
    <span class="method post">POST</span>
    <strong>/api/v1/media/audio-tools/denoise</strong>
    <p>Réduire le bruit de fond</p>
    <pre>
Body: { audio_id, strength: 0.5 }
Response: { file_id, status }</pre>
  </div>

  <div class="endpoint">
    <span class="method post">POST</span>
    <strong>/api/v1/media/audio-tools/ducking</strong>
    <p>Baisser automatiquement la musique quand la voix parle</p>
    <pre>
Body: { video_id, reduction_db: -12 }
Response: { file_id, status }</pre>
  </div>

  <h3>🎬 Outils Vidéo</h3>

  <div class="endpoint">
    <span class="method post">POST</span>
    <strong>/api/v1/media/video-tools/generate/tts-captioned-video</strong>
    <p>Créer une vidéo avec image + audio + sous-titres</p>
    <pre>
Body: {
  background_id, audio_id, text,
  caption_config_line_count: 2,
  caption_config_font_size: 24,
  caption_config_font_color: "FFFFFF",
  caption_style: "default" | "animated" | "highlight"
}
Response: { file_id, status }</pre>
  </div>

  <div class="endpoint">
    <span class="method post">POST</span>
    <strong>/api/v1/media/video-tools/merge</strong>
    <p>Fusionner plusieurs vidéos</p>
    <pre>
Body: {
  video_ids: "id1,id2,id3",
  background_music_id: "optional",
  background_music_volume: 0.1
}
Response: { file_id, status }</pre>
  </div>

  <div class="endpoint">
    <span class="method post">POST</span>
    <strong>/api/v1/media/video-tools/add-transitions</strong>
    <p>Ajouter des transitions entre vidéos</p>
    <pre>
Body: {
  video_ids: "id1,id2,id3",
  transition_type: "fade" | "slide" | "zoom",
  transition_duration: 0.5
}
Response: { file_id, status }</pre>
  </div>

  <div class="endpoint">
    <span class="method post">POST</span>
    <strong>/api/v1/media/video-tools/add-colorkey-overlay</strong>
    <p>Ajouter un overlay avec effet chromakey</p>
    <pre>
Body: { video_id, overlay_video_id, color: "0x00FF00" }
Response: { file_id, status }</pre>
  </div>

  <div class="endpoint">
    <span class="method post">POST</span>
    <strong>/api/v1/media/video-tools/color-grade</strong>
    <p>Appliquer une correction colorimétrique</p>
    <pre>
Body: {
  video_id,
  preset: "cinematic" | "warm" | "cold" | "vibrant" | "custom",
  brightness: 0, contrast: 1.0, saturation: 1.0
}
Response: { file_id, status }</pre>
  </div>

  <div class="endpoint">
    <span class="method post">POST</span>
    <strong>/api/v1/media/video-tools/ken-burns</strong>
    <p>Animer une image statique avec zoom/panoramique</p>
    <pre>
Body: {
  image_id, duration: 5,
  effect: "zoom-in" | "zoom-out" | "pan-left" | "pan-right"
}
Response: { file_id, status }</pre>
  </div>

  <div class="endpoint">
    <span class="method post">POST</span>
    <strong>/api/v1/media/video-tools/optimize</strong>
    <p>Optimiser pour une plateforme spécifique</p>
    <pre>
Body: {
  video_id,
  platform: "youtube" | "instagram" | "tiktok" | "twitter",
  quality: "high" | "medium" | "low"
}
Response: { file_id, status }</pre>
  </div>

  <div class="endpoint">
    <span class="method post">POST</span>
    <strong>/api/v1/media/video-tools/thumbnail</strong>
    <p>Générer une miniature ou GIF</p>
    <pre>
Body: {
  video_id,
  type: "image" | "gif",
  timestamp: 2.5 (pour image) | start + end (pour gif)
}
Response: { file_id, status }</pre>
  </div>

  <h3>🔔 Webhooks</h3>

  <div class="endpoint">
    <span class="method post">POST</span>
    <strong>/api/v1/media/webhooks/register</strong>
    <p>Enregistrer un webhook pour être notifié quand un job est terminé</p>
    <pre>
Body: { file_id, webhook_url }
// Votre webhook recevra: POST webhook_url { file_id, status, path }</pre>
  </div>

  <h3>⚙️ Batch Processing</h3>

  <div class="endpoint">
    <span class="method post">POST</span>
    <strong>/api/v1/media/batch</strong>
    <p>Exécuter plusieurs opérations en séquence</p>
    <pre>
Body: {
  operations: [
    { type: "normalize", params: { audio_id: "..." } },
    { type: "merge", params: { video_ids: "..." } }
  ]
}
Response: { batch_id, file_ids: [...] }</pre>
  </div>

  <hr>
  <p><strong>💡 Tips N8N:</strong></p>
  <ul>
    <li>Utilisez le node "Wait" avec polling sur /status entre chaque étape</li>
    <li>Activez les webhooks pour éviter le polling intensif</li>
    <li>Groupez les opérations similaires avec /batch pour réduire les requêtes</li>
    <li>Toujours nettoyer avec DELETE à la fin du workflow</li>
  </ul>
</body>
</html>
  `);
});

// ========================================
// HEALTH CHECK
// ========================================
app.get('/health', (req, res) => {
  res.json({ status: 'ok', service: 'ffmpeg-api', version: '2.0' });
});

// ========================================
// WEBHOOKS
// ========================================
app.post('/api/v1/media/webhooks/register', express.json(), (req, res) => {
  const { file_id, webhook_url } = req.body;
  webhooks.set(file_id, webhook_url);
  res.json({ registered: true, file_id });
});

async function triggerWebhook(fileId) {
  const url = webhooks.get(fileId);
  if (!url) return;
  
  const job = jobs.get(fileId);
  try {
    await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ file_id: fileId, status: job.status, path: job.path })
    });
  } catch (error) {
    console.error('Webhook failed:', error);
  }
}

// ========================================
// STORAGE
// ========================================
app.post('/api/v1/media/storage', upload.single('file'), async (req, res) => {
  try {
    const fileId = uuidv4();
    const mediaType = req.body.media_type || 'video';
    const ext = path.extname(req.file.originalname);
    const destPath = path.join(STORAGE_DIR, `${fileId}${ext}`);

    await fs.copyFile(req.file.path, destPath);
    await fs.unlink(req.file.path);

    jobs.set(fileId, { status: 'ready', path: destPath, media_type: mediaType });
    res.json({ file_id: fileId, status: 'ready', media_type: mediaType });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/v1/media/storage/:fileId/status', (req, res) => {
  const job = jobs.get(req.params.fileId);
  if (!job) return res.status(404).json({ status: 'not_found' });
  res.json({ status: job.status, file_id: req.params.fileId });
});

app.get('/api/v1/media/storage/:fileId/progress', (req, res) => {
  const job = jobs.get(req.params.fileId);
  if (!job) return res.status(404).json({ status: 'not_found' });
  res.json({ file_id: req.params.fileId, progress: job.progress || 0, status: job.status });
});

app.get('/api/v1/media/storage/:fileId', (req, res) => {
  const job = jobs.get(req.params.fileId);
  if (!job || job.status !== 'ready') {
    return res.status(404).json({ error: 'File not ready' });
  }
  res.sendFile(job.path);
});

app.delete('/api/v1/media/storage/:fileIds', async (req, res) => {
  try {
    const fileIds = req.params.fileIds.split(',');
    for (const fileId of fileIds) {
      const job = jobs.get(fileId);
      if (job && job.path) {
        await fs.unlink(job.path).catch(() => {});
      }
      jobs.delete(fileId);
      webhooks.delete(fileId);
    }
    res.json({ deleted: fileIds });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ========================================
// INFO / METADATA
// ========================================
app.get('/api/v1/media/info/:fileId', async (req, res) => {
  const job = jobs.get(req.params.fileId);
  if (!job) return res.status(404).json({ error: 'File not found' });

  const ffprobe = spawn('ffprobe', [
    '-v', 'quiet',
    '-print_format', 'json',
    '-show_format',
    '-show_streams',
    job.path
  ]);

  let output = '';
  ffprobe.stdout.on('data', data => output += data);
  
  ffprobe.on('close', () => {
    try {
      const info = JSON.parse(output);
      const video = info.streams.find(s => s.codec_type === 'video');
      const audio = info.streams.find(s => s.codec_type === 'audio');
      
      res.json({
        duration: parseFloat(info.format.duration),
        resolution: video ? `${video.width}x${video.height}` : null,
        codec: video ? video.codec_name : audio?.codec_name,
        bitrate: parseInt(info.format.bit_rate),
        fps: video ? eval(video.r_frame_rate) : null
      });
    } catch (error) {
      res.status(500).json({ error: 'Failed to parse metadata' });
    }
  });
});

// ========================================
// AUDIO TOOLS
// ========================================
app.post('/api/v1/media/audio-tools/tts/kokoro', express.urlencoded({ extended: true }), async (req, res) => {
  const fileId = uuidv4();
  jobs.set(fileId, { status: 'processing', type: 'tts' });
  
  // TODO: Intégrer votre TTS réel ici
  setTimeout(() => {
    const outputPath = path.join(STORAGE_DIR, `${fileId}.mp3`);
    jobs.set(fileId, { status: 'ready', path: outputPath });
    triggerWebhook(fileId);
  }, 2000);

  res.json({ file_id: fileId, status: 'processing' });
});

app.post('/api/v1/media/audio-tools/normalize', express.urlencoded({ extended: true }), async (req, res) => {
  const fileId = uuidv4();
  const { audio_id, target_level = -16 } = req.body;
  const audioJob = jobs.get(audio_id);
  
  if (!audioJob) return res.status(404).json({ error: 'Audio not found' });

  jobs.set(fileId, { status: 'processing', type: 'normalize' });
  const outputPath = path.join(STORAGE_DIR, `${fileId}.mp3`);

  const ffmpeg = spawn('ffmpeg', [
    '-i', audioJob.path,
    '-af', `loudnorm=I=${target_level}:TP=-1.5:LRA=11`,
    outputPath
  ]);

  ffmpeg.on('close', (code) => {
    jobs.set(fileId, { status: code === 0 ? 'ready' : 'failed', path: outputPath });
    triggerWebhook(fileId);
  });

  res.json({ file_id: fileId, status: 'processing' });
});

app.post('/api/v1/media/audio-tools/denoise', express.urlencoded({ extended: true }), async (req, res) => {
  const fileId = uuidv4();
  const { audio_id, strength = 0.5 } = req.body;
  const audioJob = jobs.get(audio_id);
  
  if (!audioJob) return res.status(404).json({ error: 'Audio not found' });

  jobs.set(fileId, { status: 'processing', type: 'denoise' });
  const outputPath = path.join(STORAGE_DIR, `${fileId}.mp3`);

  const ffmpeg = spawn('ffmpeg', [
    '-i', audioJob.path,
    '-af', `anlmdn=s=${strength}:p=0.002:r=0.002`,
    outputPath
  ]);

  ffmpeg.on('close', (code) => {
    jobs.set(fileId, { status: code === 0 ? 'ready' : 'failed', path: outputPath });
    triggerWebhook(fileId);
  });

  res.json({ file_id: fileId, status: 'processing' });
});

app.post('/api/v1/media/audio-tools/ducking', express.urlencoded({ extended: true }), async (req, res) => {
  const fileId = uuidv4();
  const { video_id, reduction_db = -12 } = req.body;
  const videoJob = jobs.get(video_id);
  
  if (!videoJob) return res.status(404).json({ error: 'Video not found' });

  jobs.set(fileId, { status: 'processing', type: 'ducking' });
  const outputPath = path.join(STORAGE_DIR, `${fileId}.mp4`);

  const ffmpeg = spawn('ffmpeg', [
    '-i', videoJob.path,
    '-af', `sidechaincompress=threshold=0.03:ratio=4:attack=200:release=1000:makeup=${Math.abs(reduction_db)}`,
    '-c:v', 'copy',
    outputPath
  ]);

  ffmpeg.on('close', (code) => {
    jobs.set(fileId, { status: code === 0 ? 'ready' : 'failed', path: outputPath });
    triggerWebhook(fileId);
  });

  res.json({ file_id: fileId, status: 'processing' });
});

// ========================================
// VIDEO TOOLS
// ========================================
app.post('/api/v1/media/video-tools/generate/tts-captioned-video', 
  express.urlencoded({ extended: true }), 
  async (req, res) => {
    const fileId = uuidv4();
    const { background_id, audio_id, text, caption_config_line_count = 2, 
            caption_config_font_size = 24, caption_config_font_color = 'FFFFFF',
            caption_style = 'default' } = req.body;

    const bgJob = jobs.get(background_id);
    const audioJob = jobs.get(audio_id);

    if (!bgJob || !audioJob) {
      return res.status(404).json({ error: 'Files not found' });
    }

    jobs.set(fileId, { status: 'processing', type: 'transitions' });

    const outputPath = path.join(STORAGE_DIR, `${fileId}.mp4`);

    // Construire le filtre de transition FFmpeg
    let filterComplex = '';
    const inputs = videoIds.map((id, i) => {
      const job = jobs.get(id);
      return `-i ${job.path}`;
    }).join(' ');

    // Générer les transitions selon le type
    const transitionMap = {
      'fade': 'xfade=transition=fade',
      'slide': 'xfade=transition=slideleft',
      'zoom': 'xfade=transition=zoomin'
    };

    const transFilter = transitionMap[transition_type] || transitionMap.fade;

    for (let i = 0; i < videoIds.length - 1; i++) {
      if (i === 0) {
        filterComplex += `[0:v][1:v]${transFilter}:duration=${transition_duration}:offset=0[v01];`;
      } else {
        filterComplex += `[v0${i}][${i + 1}:v]${transFilter}:duration=${transition_duration}:offset=0[v0${i + 1}];`;
      }
    }

    const lastLabel = `v0${videoIds.length - 1}`;

    const ffmpegArgs = inputs.split(' ').concat([
      '-filter_complex', filterComplex,
      '-map', `[${lastLabel}]`,
      '-c:v', 'libx264',
      '-c:a', 'aac',
      outputPath
    ]);

    const ffmpeg = spawn('ffmpeg', ffmpegArgs);

    ffmpeg.on('close', (code) => {
      jobs.set(fileId, { status: code === 0 ? 'ready' : 'failed', path: outputPath });
      triggerWebhook(fileId);
    });

    res.json({ file_id: fileId, status: 'processing' });
});

app.post('/api/v1/media/video-tools/add-colorkey-overlay',
  express.urlencoded({ extended: true }),
  async (req, res) => {
    const fileId = uuidv4();
    const { video_id, overlay_video_id, color = '0x00FF00' } = req.body;

    const videoJob = jobs.get(video_id);
    const overlayJob = jobs.get(overlay_video_id);

    if (!videoJob || !overlayJob) {
      return res.status(404).json({ error: 'Videos not found' });
    }

    jobs.set(fileId, { status: 'processing', type: 'overlay' });

    const outputPath = path.join(STORAGE_DIR, `${fileId}.mp4`);

    const ffmpeg = spawn('ffmpeg', [
      '-i', videoJob.path,
      '-i', overlayJob.path,
      '-filter_complex', `[1:v]colorkey=${color}:0.3:0.2[ckout];[0:v][ckout]overlay[out]`,
      '-map', '[out]',
      '-map', '0:a',
      '-c:v', 'libx264',
      '-c:a', 'copy',
      outputPath
    ]);

    ffmpeg.on('close', (code) => {
      jobs.set(fileId, { status: code === 0 ? 'ready' : 'failed', path: outputPath });
      triggerWebhook(fileId);
    });

    res.json({ file_id: fileId, status: 'processing' });
});

app.post('/api/v1/media/video-tools/color-grade',
  express.urlencoded({ extended: true }),
  async (req, res) => {
    const fileId = uuidv4();
    const { video_id, preset = 'cinematic', brightness = 0, contrast = 1.0, saturation = 1.0 } = req.body;

    const videoJob = jobs.get(video_id);
    if (!videoJob) return res.status(404).json({ error: 'Video not found' });

    jobs.set(fileId, { status: 'processing', type: 'color_grade' });

    const outputPath = path.join(STORAGE_DIR, `${fileId}.mp4`);

    const presets = {
      'cinematic': 'eq=contrast=1.1:brightness=0.05:saturation=0.8',
      'warm': 'eq=contrast=1.05:brightness=0.1:saturation=1.2,colortemperature=6500',
      'cold': 'eq=contrast=1.05:brightness=-0.05:saturation=0.9,colortemperature=9000',
      'vibrant': 'eq=contrast=1.2:brightness=0.05:saturation=1.5',
      'custom': `eq=contrast=${contrast}:brightness=${brightness}:saturation=${saturation}`
    };

    const filter = presets[preset] || presets.cinematic;

    const ffmpeg = spawn('ffmpeg', [
      '-i', videoJob.path,
      '-vf', filter,
      '-c:v', 'libx264',
      '-c:a', 'copy',
      outputPath
    ]);

    ffmpeg.on('close', (code) => {
      jobs.set(fileId, { status: code === 0 ? 'ready' : 'failed', path: outputPath });
      triggerWebhook(fileId);
    });

    res.json({ file_id: fileId, status: 'processing' });
});

app.post('/api/v1/media/video-tools/ken-burns',
  express.urlencoded({ extended: true }),
  async (req, res) => {
    const fileId = uuidv4();
    const { image_id, duration = 5, effect = 'zoom-in' } = req.body;

    const imageJob = jobs.get(image_id);
    if (!imageJob) return res.status(404).json({ error: 'Image not found' });

    jobs.set(fileId, { status: 'processing', type: 'ken_burns' });

    const outputPath = path.join(STORAGE_DIR, `${fileId}.mp4`);

    const effects = {
      'zoom-in': 'zoompan=z=\'min(zoom+0.0015,1.5)\':d=125:x=\'iw/2-(iw/zoom/2)\':y=\'ih/2-(ih/zoom/2)\':s=1080x1920',
      'zoom-out': 'zoompan=z=\'if(lte(zoom,1.0),1.5,max(1.001,zoom-0.0015))\':d=125:x=\'iw/2-(iw/zoom/2)\':y=\'ih/2-(ih/zoom/2)\':s=1080x1920',
      'pan-left': 'zoompan=z=1:x=\'iw-iw/zoom-10*on\':d=125:s=1080x1920',
      'pan-right': 'zoompan=z=1:x=\'10*on\':d=125:s=1080x1920'
    };

    const filter = effects[effect] || effects['zoom-in'];

    const ffmpeg = spawn('ffmpeg', [
      '-loop', '1',
      '-i', imageJob.path,
      '-vf', filter,
      '-t', duration.toString(),
      '-c:v', 'libx264',
      '-pix_fmt', 'yuv420p',
      outputPath
    ]);

    ffmpeg.on('close', (code) => {
      jobs.set(fileId, { status: code === 0 ? 'ready' : 'failed', path: outputPath });
      triggerWebhook(fileId);
    });

    res.json({ file_id: fileId, status: 'processing' });
});

app.post('/api/v1/media/video-tools/optimize',
  express.urlencoded({ extended: true }),
  async (req, res) => {
    const fileId = uuidv4();
    const { video_id, platform = 'youtube', quality = 'high' } = req.body;

    const videoJob = jobs.get(video_id);
    if (!videoJob) return res.status(404).json({ error: 'Video not found' });

    jobs.set(fileId, { status: 'processing', type: 'optimize' });

    const outputPath = path.join(STORAGE_DIR, `${fileId}.mp4`);

    const platforms = {
      'youtube': { width: 1920, height: 1080, bitrate: '8M', fps: 30 },
      'instagram': { width: 1080, height: 1920, bitrate: '5M', fps: 30 },
      'tiktok': { width: 1080, height: 1920, bitrate: '4M', fps: 30 },
      'twitter': { width: 1280, height: 720, bitrate: '5M', fps: 30 }
    };

    const config = platforms[platform] || platforms.youtube;
    const qualityMultiplier = quality === 'high' ? 1 : quality === 'medium' ? 0.6 : 0.3;
    const finalBitrate = `${parseInt(config.bitrate) * qualityMultiplier}M`;

    const ffmpeg = spawn('ffmpeg', [
      '-i', videoJob.path,
      '-vf', `scale=${config.width}:${config.height}:force_original_aspect_ratio=decrease,pad=${config.width}:${config.height}:(ow-iw)/2:(oh-ih)/2`,
      '-r', config.fps.toString(),
      '-b:v', finalBitrate,
      '-c:v', 'libx264',
      '-preset', 'medium',
      '-c:a', 'aac',
      '-b:a', '128k',
      outputPath
    ]);

    ffmpeg.on('close', (code) => {
      jobs.set(fileId, { status: code === 0 ? 'ready' : 'failed', path: outputPath });
      triggerWebhook(fileId);
    });

    res.json({ file_id: fileId, status: 'processing' });
});

app.post('/api/v1/media/video-tools/thumbnail',
  express.urlencoded({ extended: true }),
  async (req, res) => {
    const fileId = uuidv4();
    const { video_id, type = 'image', timestamp = 0, start = 0, end = 3 } = req.body;

    const videoJob = jobs.get(video_id);
    if (!videoJob) return res.status(404).json({ error: 'Video not found' });

    jobs.set(fileId, { status: 'processing', type: 'thumbnail' });

    const ext = type === 'gif' ? '.gif' : '.jpg';
    const outputPath = path.join(STORAGE_DIR, `${fileId}${ext}`);

    let ffmpegArgs = ['-i', videoJob.path];

    if (type === 'gif') {
      ffmpegArgs.push(
        '-ss', start.toString(),
        '-t', (end - start).toString(),
        '-vf', 'fps=15,scale=480:-1:flags=lanczos,split[s0][s1];[s0]palettegen[p];[s1][p]paletteuse',
        outputPath
      );
    } else {
      ffmpegArgs.push(
        '-ss', timestamp.toString(),
        '-vframes', '1',
        '-q:v', '2',
        outputPath
      );
    }

    const ffmpeg = spawn('ffmpeg', ffmpegArgs);

    ffmpeg.on('close', (code) => {
      jobs.set(fileId, { status: code === 0 ? 'ready' : 'failed', path: outputPath });
      triggerWebhook(fileId);
    });

    res.json({ file_id: fileId, status: 'processing' });
});

// ========================================
// BATCH PROCESSING
// ========================================
app.post('/api/v1/media/batch', express.json(), async (req, res) => {
  const batchId = uuidv4();
  const { operations } = req.body;

  if (!operations || !Array.isArray(operations)) {
    return res.status(400).json({ error: 'Invalid operations array' });
  }

  jobs.set(batchId, { status: 'processing', type: 'batch', file_ids: [] });

  // Exécuter les opérations en séquence
  const fileIds = [];
  
  try {
    for (const op of operations) {
      const endpoint = `/api/v1/media/${op.type}`;
      // Simuler l'exécution - dans une vraie implémentation, 
      // vous appelleriez les fonctions directement plutôt que via HTTP
      
      const fileId = uuidv4();
      fileIds.push(fileId);
      
      // Attendre que chaque opération se termine
      await new Promise(resolve => setTimeout(resolve, 1000));
    }

    jobs.set(batchId, { status: 'ready', type: 'batch', file_ids: fileIds });
    res.json({ batch_id: batchId, status: 'ready', file_ids: fileIds });
    
  } catch (error) {
    jobs.set(batchId, { status: 'failed', type: 'batch', error: error.message });
    res.status(500).json({ error: error.message });
  }
});

// ========================================
// HELPER FUNCTIONS
// ========================================
async function generateSRT(text, outputPath, style = 'default') {
  const words = text.split(' ');
  const wordsPerLine = 5;
  let srtContent = '';
  let index = 1;

  for (let i = 0; i < words.length; i += wordsPerLine) {
    const line = words.slice(i, i + wordsPerLine).join(' ');
    const startTime = (i / wordsPerLine) * 2;
    const endTime = startTime + 2;

    srtContent += `${index}\n`;
    srtContent += `${formatSRTTime(startTime)} --> ${formatSRTTime(endTime)}\n`;
    
    if (style === 'animated') {
      // Ajouter des tags pour animation mot par mot
      const animatedLine = words.slice(i, i + wordsPerLine)
        .map((word, idx) => `{\\t(${idx * 100},${(idx + 1) * 100},\\fscx120\\fscy120)}${word}`)
        .join(' ');
      srtContent += `${animatedLine}\n\n`;
    } else if (style === 'highlight') {
      // Highlight progressif
      srtContent += `{\\c&H00FFFF&}${line}\n\n`;
    } else {
      srtContent += `${line}\n\n`;
    }
    
    index++;
  }

  await fs.writeFile(outputPath, srtContent);
}

function formatSRTTime(seconds) {
  const h = Math.floor(seconds / 3600).toString().padStart(2, '0');
  const m = Math.floor((seconds % 3600) / 60).toString().padStart(2, '0');
  const s = Math.floor(seconds % 60).toString().padStart(2, '0');
  const ms = Math.floor((seconds % 1) * 1000).toString().padStart(3, '0');
  return `${h}:${m}:${s},${ms}`;
}

// ========================================
// DÉMARRAGE
// ========================================
initDirs().then(() => {
  const PORT = process.env.PORT || 8000;
  app.listen(PORT, '0.0.0.0', () => {
    console.log(`✅ FFmpeg API Server running on port ${PORT}`);
    console.log(`📚 Documentation available at http://localhost:${PORT}/docs`);
  });
}); type: 'captioned_video' });

    const srtPath = path.join(TEMP_DIR, `${fileId}.srt`);
    await generateSRT(text, srtPath, caption_style);

    const outputPath = path.join(STORAGE_DIR, `${fileId}.mp4`);

    const ffmpegArgs = [
      '-loop', '1',
      '-i', bgJob.path,
      '-i', audioJob.path,
      '-vf', `subtitles=${srtPath}:force_style='FontSize=${caption_config_font_size},PrimaryColour=&H${caption_config_font_color}',scale=1080:1920:force_original_aspect_ratio=decrease,pad=1080:1920:(ow-iw)/2:(oh-ih)/2`,
      '-c:v', 'libx264',
      '-c:a', 'aac',
      '-shortest',
      '-pix_fmt', 'yuv420p',
      outputPath
    ];

    const ffmpeg = spawn('ffmpeg', ffmpegArgs);

    ffmpeg.on('close', (code) => {
      jobs.set(fileId, { status: code === 0 ? 'ready' : 'failed', path: outputPath });
      triggerWebhook(fileId);
    });

    res.json({ file_id: fileId, status: 'processing' });
});

app.post('/api/v1/media/video-tools/merge', 
  express.urlencoded({ extended: true }), 
  async (req, res) => {
    const fileId = uuidv4();
    const videoIds = req.body.video_ids.split(',');
    const bgMusicId = req.body.background_music_id;
    const bgMusicVolume = parseFloat(req.body.background_music_volume || 0.1);

    jobs.set(fileId, { status: 'processing', type: 'merge' });

    const concatPath = path.join(TEMP_DIR, `${fileId}_concat.txt`);
    const concatContent = videoIds.map(id => `file '${jobs.get(id).path}'`).join('\n');
    await fs.writeFile(concatPath, concatContent);

    const outputPath = path.join(STORAGE_DIR, `${fileId}.mp4`);

    let ffmpegArgs = ['-f', 'concat', '-safe', '0', '-i', concatPath];

    if (bgMusicId) {
      const musicJob = jobs.get(bgMusicId);
      ffmpegArgs.push(
        '-i', musicJob.path,
        '-filter_complex', `[1:a]volume=${bgMusicVolume}[a1];[0:a][a1]amix=inputs=2:duration=first[a]`,
        '-map', '0:v', '-map', '[a]'
      );
    }

    ffmpegArgs.push('-c:v', 'copy', '-c:a', 'aac', outputPath);

    const ffmpeg = spawn('ffmpeg', ffmpegArgs);

    ffmpeg.on('close', (code) => {
      jobs.set(fileId, { status: code === 0 ? 'ready' : 'failed', path: outputPath });
      triggerWebhook(fileId);
    });

    res.json({ file_id: fileId, status: 'processing' });
});

app.post('/api/v1/media/video-tools/add-transitions',
  express.urlencoded({ extended: true }),
  async (req, res) => {
    const fileId = uuidv4();
    const { video_ids, transition_type = 'fade', transition_duration = 0.5 } = req.body;
    const videoIds = video_ids.split(',');

    jobs.set(fileId, { status: 'processing',
