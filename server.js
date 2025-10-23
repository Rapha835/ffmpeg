// ========================================
// ENDPOINTS À AJOUTER AU SERVER.JS
// ========================================

// ========================================
// 1. ASSEMBLAGE VIDÉO - CONCATENATION
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
// 2. MERGE AUDIO + VIDEO
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
// 3. EFFET KEN BURNS (Zoom/Pan sur image)
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
// 4. BACKGROUND BLUR (Image en arrière-plan)
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
// 5. AJOUTER OVERLAY (Logo/Watermark)
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
// 6. APPLIQUER FILTRES VIDÉO
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
// 7. AJOUTER FADE IN/OUT
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
// 8. CRÉER VIDÉO DEPUIS IMAGE + AUDIO + SRT
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
