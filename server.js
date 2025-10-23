// server.js - FFmpeg API Node.js complet compatible Node 20+
const express = require('express');
const multer = require('multer');
const { spawn } = require('child_process');
const fs = require('fs').promises;
const path = require('path');
const { v4: uuidv4 } = require('uuid');

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
// UTILITY FUNCTIONS
// ========================================
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

async function generateSRT(text, outputPath) {
  const lines = text.split('. ').filter(Boolean);
  let srt = '';
  lines.forEach((line, i) => {
    const start = i * 3;
    const end = start + 3;
    srt += `${i + 1}\n00:00:${start.toString().padStart(2,'0')},000 --> 00:00:${end.toString().padStart(2,'0')},000\n${line.trim()}\n\n`;
  });
  await fs.writeFile(outputPath, srt);
}

// ========================================
// DOCUMENTATION & HEALTH CHECK
// ========================================
app.get('/docs', (req, res) => {
  res.sendFile(path.join(__dirname, 'docs.html'));
});

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
// VIDEO TOOLS - CONCATENATION
// ========================================
app.post('/api/v1/media/video-tools/concat', express.json(), async (req, res) => {
  const fileId = uuidv4();
  const { video_ids, transition = 'none', transition_duration = 1 } = req.body;
  
  if (!video_ids || video_ids.length < 2) {
    return res.status(400).json({ error: 'Au moins 2 vidéos requises' });
  }

  const videoJobs = video_ids.map(id => jobs.get(id)).filter(Boolean);
  if (videoJobs.length !== video_ids.length) {
    return res.status(404).json({ error: 'Une ou plusieurs vidéos introuvables' });
  }

  jobs.set(fileId, { status: 'processing', type: 'concat' });
  const outputPath = path.join(STORAGE_DIR, `${fileId}.mp4`);
  const concatFile = path.join(TEMP_DIR, `${fileId}_concat.txt`);

  try {
    if (transition === 'none') {
      // Concat simple sans transition
      const fileList = videoJobs.map(job => `file '${job.path}'`).join('\n');
      await fs.writeFile(concatFile, fileList);

      const ffmpeg = spawn('ffmpeg', [
        '-f', 'concat',
        '-safe', '0',
        '-i', concatFile,
        '-c', 'copy',
        outputPath
      ]);

      ffmpeg.on('close', async (code) => {
        await fs.unlink(concatFile).catch(() => {});
        jobs.set(fileId, { status: code === 0 ? 'ready' : 'failed', path: outputPath });
        triggerWebhook(fileId);
      });
    } else {
      // Concat avec transition (xfade)
      const inputs = videoJobs.flatMap(job => ['-i', job.path]);
      const xfadeFilters = [];
      
      for (let i = 0; i < videoJobs.length - 1; i++) {
        const offset = i * 5; // Durée approximative par clip
        xfadeFilters.push(
          i === 0 
            ? `[0:v][1:v]xfade=transition=${transition}:duration=${transition_duration}:offset=${offset}[v${i}]`
            : `[v${i-1}][${i+1}:v]xfade=transition=${transition}:duration=${transition_duration}:offset=${offset}[v${i}]`
        );
      }

      const filterComplex = xfadeFilters.join(';');
      const lastOutput = `[v${videoJobs.length - 2}]`;

      const ffmpeg = spawn('ffmpeg', [
        ...inputs,
        '-filter_complex', filterComplex,
        '-map', lastOutput,
        '-c:v', 'libx264',
        '-preset', 'medium',
        outputPath
      ]);

      ffmpeg.on('close', (code) => {
        jobs.set(fileId, { status: code === 0 ? 'ready' : 'failed', path: outputPath });
        triggerWebhook(fileId);
      });
    }

    res.json({ file_id: fileId, status: 'processing' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ========================================
// VIDEO TOOLS - MERGE AUDIO
// ========================================
app.post('/api/v1/media/video-tools/merge-audio', express.json(), async (req, res) => {
  const fileId = uuidv4();
  const { video_id, audio_id, audio_volume = 1.0, replace_audio = true } = req.body;
  
  const videoJob = jobs.get(video_id);
  const audioJob = jobs.get(audio_id);
  
  if (!videoJob || !audioJob) {
    return res.status(404).json({ error: 'Vidéo ou audio introuvable' });
  }

  jobs.set(fileId, { status: 'processing', type: 'merge_audio' });
  const outputPath = path.join(STORAGE_DIR, `${fileId}.mp4`);

  const ffmpegArgs = [
    '-i', videoJob.path,
    '-i', audioJob.path,
    '-c:v', 'copy',
    '-map', '0:v:0',
  ];

  if (replace_audio) {
    ffmpegArgs.push('-map', '1:a:0');
  } else {
    ffmpegArgs.push('-filter_complex', `[1:a]volume=${audio_volume}[a1];[0:a][a1]amix=inputs=2[aout]`);
    ffmpegArgs.push('-map', '[aout]');
  }

  ffmpegArgs.push('-shortest', outputPath);

  const ffmpeg = spawn('ffmpeg', ffmpegArgs);

  ffmpeg.on('close', (code) => {
    jobs.set(fileId, { status: code === 0 ? 'ready' : 'failed', path: outputPath });
    triggerWebhook(fileId);
  });

  res.json({ file_id: fileId, status: 'processing' });
});

// ========================================
// VIDEO TOOLS - KEN BURNS EFFECT
// ========================================
app.post('/api/v1/media/video-tools/ken-burns', express.json(), async (req, res) => {
  const fileId = uuidv4();
  const { 
    image_id, 
    duration = 5, 
    zoom_start = 1.0, 
    zoom_end = 1.2,
    direction = 'center' // center, left, right, top, bottom
  } = req.body;
  
  const imageJob = jobs.get(image_id);
  if (!imageJob) return res.status(404).json({ error: 'Image introuvable' });

  jobs.set(fileId, { status: 'processing', type: 'ken_burns' });
  const outputPath = path.join(STORAGE_DIR, `${fileId}.mp4`);

  // Calcul des coordonnées selon la direction
  const directions = {
    center: { x: '(iw-iw/zoom)/2', y: '(ih-ih/zoom)/2' },
    left: { x: '0', y: '(ih-ih/zoom)/2' },
    right: { x: 'iw-iw/zoom', y: '(ih-ih/zoom)/2' },
    top: { x: '(iw-iw/zoom)/2', y: '0' },
    bottom: { x: '(iw-iw/zoom)/2', y: 'ih-ih/zoom' }
  };

  const coords = directions[direction] || directions.center;
  const zoomFilter = `zoompan=z='min(zoom+0.0015,${zoom_end})':x='${coords.x}':y='${coords.y}':d=${duration * 25}:s=1920x1080`;

  const ffmpeg = spawn('ffmpeg', [
    '-loop', '1',
    '-i', imageJob.path,
    '-vf', zoomFilter,
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

// ========================================
// VIDEO TOOLS - BLUR BACKGROUND
// ========================================
app.post('/api/v1/media/video-tools/blur-background', express.json(), async (req, res) => {
  const fileId = uuidv4();
  const { 
    image_id, 
    blur_strength = 20, 
    scale = 0.8,
    output_width = 1080,
    output_height = 1920
  } = req.body;
  
  const imageJob = jobs.get(image_id);
  if (!imageJob) return res.status(404).json({ error: 'Image introuvable' });

  jobs.set(fileId, { status: 'processing', type: 'blur_bg' });
  const outputPath = path.join(STORAGE_DIR, `${fileId}.jpg`);

  const filterComplex = [
    `[0:v]scale=${output_width}:${output_height}:force_original_aspect_ratio=increase,crop=${output_width}:${output_height},boxblur=${blur_strength}[bg]`,
    `[0:v]scale=iw*${scale}:ih*${scale}:force_original_aspect_ratio=decrease[fg]`,
    `[bg][fg]overlay=(W-w)/2:(H-h)/2`
  ].join(';');

  const ffmpeg = spawn('ffmpeg', [
    '-i', imageJob.path,
    '-filter_complex', filterComplex,
    '-q:v', '2',
    outputPath
  ]);

  ffmpeg.on('close', (code) => {
    jobs.set(fileId, { status: code === 0 ? 'ready' : 'failed', path: outputPath });
    triggerWebhook(fileId);
  });

  res.json({ file_id: fileId, status: 'processing' });
});

// ========================================
// VIDEO TOOLS - ADD OVERLAY
// ========================================
app.post('/api/v1/media/video-tools/add-overlay', express.json(), async (req, res) => {
  const fileId = uuidv4();
  const { 
    video_id, 
    overlay_id, 
    position = 'top-right', // top-left, top-right, bottom-left, bottom-right, center
    margin = 20,
    scale = 1.0
  } = req.body;
  
  const videoJob = jobs.get(video_id);
  const overlayJob = jobs.get(overlay_id);
  
  if (!videoJob || !overlayJob) {
    return res.status(404).json({ error: 'Vidéo ou overlay introuvable' });
  }

  jobs.set(fileId, { status: 'processing', type: 'overlay' });
  const outputPath = path.join(STORAGE_DIR, `${fileId}.mp4`);

  const positions = {
    'top-left': `${margin}:${margin}`,
    'top-right': `W-w-${margin}:${margin}`,
    'bottom-left': `${margin}:H-h-${margin}`,
    'bottom-right': `W-w-${margin}:H-h-${margin}`,
    'center': '(W-w)/2:(H-h)/2'
  };

  const overlayPos = positions[position] || positions['top-right'];
  const filterComplex = scale !== 1.0 
    ? `[1:v]scale=iw*${scale}:ih*${scale}[ovr];[0:v][ovr]overlay=${overlayPos}`
    : `[0:v][1:v]overlay=${overlayPos}`;

  const ffmpeg = spawn('ffmpeg', [
    '-i', videoJob.path,
    '-i', overlayJob.path,
    '-filter_complex', filterComplex,
    '-c:a', 'copy',
    outputPath
  ]);

  ffmpeg.on('close', (code) => {
    jobs.set(fileId, { status: code === 0 ? 'ready' : 'failed', path: outputPath });
    triggerWebhook(fileId);
  });

  res.json({ file_id: fileId, status: 'processing' });
});

// ========================================
// VIDEO TOOLS - APPLY FILTER
// ========================================
app.post('/api/v1/media/video-tools/apply-filter', express.json(), async (req, res) => {
  const fileId = uuidv4();
  const { 
    video_id, 
    filter_type = 'brightness', // brightness, contrast, saturation, blur, sharpen
    intensity = 1.0 
  } = req.body;
  
  const videoJob = jobs.get(video_id);
  if (!videoJob) return res.status(404).json({ error: 'Vidéo introuvable' });

  jobs.set(fileId, { status: 'processing', type: 'filter' });
  const outputPath = path.join(STORAGE_DIR, `${fileId}.mp4`);

  const filters = {
    brightness: `eq=brightness=${(intensity - 1) * 0.5}`,
    contrast: `eq=contrast=${intensity}`,
    saturation: `eq=saturation=${intensity}`,
    blur: `boxblur=${intensity * 5}`,
    sharpen: `unsharp=5:5:${intensity}:5:5:0`
  };

  const filterStr = filters[filter_type] || filters.brightness;

  const ffmpeg = spawn('ffmpeg', [
    '-i', videoJob.path,
    '-vf', filterStr,
    '-c:a', 'copy',
    outputPath
  ]);

  ffmpeg.on('close', (code) => {
    jobs.set(fileId, { status: code === 0 ? 'ready' : 'failed', path: outputPath });
    triggerWebhook(fileId);
  });

  res.json({ file_id: fileId, status: 'processing' });
});

// ========================================
// VIDEO TOOLS - ADD FADE
// ========================================
app.post('/api/v1/media/video-tools/add-fade', express.json(), async (req, res) => {
  const fileId = uuidv4();
  const { 
    video_id, 
    fade_in_duration = 1, 
    fade_out_duration = 1,
    fade_type = 'both' // in, out, both
  } = req.body;
  
  const videoJob = jobs.get(video_id);
  if (!videoJob) return res.status(404).json({ error: 'Vidéo introuvable' });

  jobs.set(fileId, { status: 'processing', type: 'fade' });
  const outputPath = path.join(STORAGE_DIR, `${fileId}.mp4`);

  // Construction du filtre fade
  let fadeFilter = '';
  if (fade_type === 'in' || fade_type === 'both') {
    fadeFilter += `fade=t=in:st=0:d=${fade_in_duration}`;
  }
  if (fade_type === 'both') fadeFilter += ',';
  if (fade_type === 'out' || fade_type === 'both') {
    fadeFilter += `fade=t=out:st=duration-${fade_out_duration}:d=${fade_out_duration}`;
  }

  const ffmpeg = spawn('ffmpeg', [
    '-i', videoJob.path,
    '-vf', fadeFilter,
    '-c:a', 'copy',
    outputPath
  ]);

  ffmpeg.on('close', (code) => {
    jobs.set(fileId, { status: code === 0 ? 'ready' : 'failed', path: outputPath });
    triggerWebhook(fileId);
  });

  res.json({ file_id: fileId, status: 'processing' });
});

// ========================================
// VIDEO TOOLS - COMPOSE VIDEO
// ========================================
app.post('/api/v1/media/video-tools/compose', express.json(), async (req, res) => {
  const fileId = uuidv4();
  const { 
    image_id,
    audio_id,
    subtitle_text,
    background_color = '000000',
    caption_style = {
      font_size: 24,
      font_color: 'FFFFFF',
      position: 'bottom',
      outline: 2
    }
  } = req.body;
  
  const imageJob = jobs.get(image_id);
  const audioJob = jobs.get(audio_id);
  
  if (!imageJob || !audioJob) {
    return res.status(404).json({ error: 'Image ou audio introuvable' });
  }

  jobs.set(fileId, { status: 'processing', type: 'compose' });
  
  const srtPath = path.join(TEMP_DIR, `${fileId}.srt`);
  await generateSRT(subtitle_text, srtPath);
  
  const outputPath = path.join(STORAGE_DIR, `${fileId}.mp4`);

  const subtitleStyle = [
    `FontSize=${caption_style.font_size}`,
    `PrimaryColour=&H${caption_style.font_color}`,
    `Outline=${caption_style.outline}`,
    `Alignment=${caption_style.position === 'top' ? 8 : 2}`
  ].join(',');

  const ffmpeg = spawn('ffmpeg', [
    '-loop', '1',
    '-i', imageJob.path,
    '-i', audioJob.path,
    '-vf', `subtitles=${srtPath}:force_style='${subtitleStyle}',scale=1080:1920:force_original_aspect_ratio=decrease,pad=1080:1920:(ow-iw)/2:(oh-ih)/2:color=#${background_color}`,
    '-c:v', 'libx264',
    '-c:a', 'aac',
    '-shortest',
    '-pix_fmt', 'yuv420p',
    outputPath
  ]);

  ffmpeg.on('close', async (code) => {
    await fs.unlink(srtPath).catch(() => {});
    jobs.set(fileId, { status: code === 0 ? 'ready' : 'failed', path: outputPath });
    triggerWebhook(fileId);
  });

  res.json({ file_id: fileId, status: 'processing' });
});

// ========================================
// SERVER INIT
// ========================================
const PORT = process.env.PORT || 8001;
initDirs().then(() => {
  app.listen(PORT, () => console.log(`FFmpeg API running on port ${PORT}`));
});
