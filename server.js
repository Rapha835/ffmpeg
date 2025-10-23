// server.js - API Node.js complète pour FFmpeg
const express = require('express');
const multer = require('multer');
const { spawn } = require('child_process');
const fs = require('fs').promises;
const path = require('path');
const { v4: uuidv4 } = require('uuid');
const fetch = require('node-fetch');

const app = express();
const upload = multer({ dest: '/tmp/uploads/' });

// Stockage en mémoire des jobs et webhooks
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
  res.send('<h1>FFmpeg API - Documentation (HTML complet supprimé pour la clarté)</h1>');
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
  if (!job || job.status !== 'ready') return res.status(404).json({ error: 'File not ready' });
  res.sendFile(job.path);
});

app.delete('/api/v1/media/storage/:fileIds', async (req, res) => {
  try {
    const fileIds = req.params.fileIds.split(',');
    for (const fileId of fileIds) {
      const job = jobs.get(fileId);
      if (job && job.path) await fs.unlink(job.path).catch(() => {});
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

  // Simulation TTS
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
async function generateSRT(text, outputPath, style = 'default') {
  const lines = text.split('. ').filter(Boolean);
  let srt = '';
  lines.forEach((line, i) => {
    const start = i * 3;
    const end = start + 3;
    srt += `${i + 1}\n00:00:${start.toString().padStart(2,'0')},000 --> 00:00:${end.toString().padStart(2,'0')},000\n${line.trim()}\n\n`;
  });
  await fs.writeFile(outputPath, srt);
}

app.post('/api/v1/media/video-tools/generate/tts-captioned-video', 
  express.urlencoded({ extended: true }), 
  async (req, res) => {
    const fileId = uuidv4();
    const { background_id, audio_id, text, 
            caption_config_font_size = 24, 
            caption_config_font_color = 'FFFFFF',
            caption_style = 'default' } = req.body;

    const bgJob = jobs.get(background_id);
    const audioJob = jobs.get(audio_id);

    if (!bgJob || !audioJob) return res.status(404).json({ error: 'Files not found' });

    jobs.set(fileId, { status: 'processing', type: 'captioned_video' });

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

// ========================================
// SERVER INIT
// ========================================
const PORT = process.env.PORT || 3000;
initDirs().then(() => {
  app.listen(PORT, () => console.log(`FFmpeg API running on port ${PORT}`));
});
