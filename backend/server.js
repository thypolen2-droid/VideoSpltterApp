const express = require('express');
const cors = require('cors');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const dotenv = require('dotenv');
const ffmpeg = require('fluent-ffmpeg');
const cron = require('node-cron');
const archiver = require('archiver');

dotenv.config();

const app = express();
const port = process.env.PORT || 5000;

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Serve the output directory statically for downloads
app.use('/output', express.static(path.join(__dirname, 'output')));

const uploadDir = path.join(__dirname, 'uploads');
const outputDir = path.join(__dirname, 'output');

if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir);
if (!fs.existsSync(outputDir)) fs.mkdirSync(outputDir);

// Configure Multer
const storage = multer.diskStorage({
    destination: (req, file, cb) => cb(null, uploadDir),
    filename: (req, file, cb) => {
        const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
        cb(null, file.fieldname + '-' + uniqueSuffix + path.extname(file.originalname));
    }
});
const upload = multer({
    storage,
    limits: { fileSize: 10 * 1024 * 1024 * 1024 } // 10GB
});

// In-memory store for active jobs and SSE clients
const jobs = {};
const taskQueue = [];
let isSplitting = false;

function processNext() {
    if (isSplitting || taskQueue.length === 0) return;
    isSplitting = true;
    const { jobId, inputPath, numClips, movieName, videoName } = taskQueue.shift();
    console.log(`[Queue] Starting job ${jobId}. Remaining in queue: ${taskQueue.length}`);
    processVideo(jobId, inputPath, numClips, movieName, videoName);
}

// 1. SSE Endpoint for Progress Tracking
app.get('/api/progress/:jobId', (req, res) => {
    const { jobId } = req.params;

    // Maintain SSE connection
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');

    // Send initial connection successful event
    res.write(`data: ${JSON.stringify({ status: 'connected' })}\n\n`);

    if (!jobs[jobId]) {
        jobs[jobId] = { clients: [], status: 'waiting' };
    }
    jobs[jobId].clients.push(res);

    req.on('close', () => {
        if (jobs[jobId]) {
            jobs[jobId].clients = jobs[jobId].clients.filter(client => client !== res);
        }
    });
});

// Helper to broadcast to SSE clients
function emitProgress(jobId, data) {
    if (jobs[jobId] && jobs[jobId].clients) {
        jobs[jobId].clients.forEach(client => {
            client.write(`data: ${JSON.stringify(data)}\n\n`);
        });
    }
}

// 2. Upload and Process Endpoint
app.post('/api/split-video', upload.single('video'), (req, res) => {
    try {
        if (!req.file) return res.status(400).json({ error: 'No video uploaded' });

        const jobId = req.body.jobId;
        const numClips = parseInt(req.body.numClips);

        if (!jobId || !numClips || numClips < 2) {
            return res.status(400).json({ error: 'Invalid jobId or numClips' });
        }

        const inputPath = req.file.path;
        console.log(`[Job ${jobId}] Received file: ${inputPath}, Parts: ${numClips}`);

        // Acknowledge upload success immediately
        res.json({ message: 'Upload successful, processing started', jobId });

        // Start processing asynchronously
        processVideo(jobId, inputPath, numClips);

    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Server error during upload' });
    }
});

// 2.5 Batch Upload and Process Endpoint
app.post('/api/split-videos-batch', upload.array('videos'), (req, res) => {
    try {
        if (!req.files || req.files.length === 0) return res.status(400).json({ error: 'No videos uploaded' });

        const batchJobId = req.body.batchJobId;
        const numClips = parseInt(req.body.numClips);
        const movieName = req.body.movieName;

        if (!batchJobId || !numClips || numClips < 2) {
            // Cleanup uploaded files just in case
            req.files.forEach(f => fs.unlink(f.path, () => { }));
            return res.status(400).json({ error: 'Invalid batchJobId or numClips' });
        }

        const jobIds = [];
        const originalNames = {};

        req.files.forEach((file, index) => {
            const jobId = `${batchJobId}_${index}`;
            jobIds.push(jobId);
            originalNames[jobId] = file.originalname;
            const inputPath = file.path;
            const originalFilenameObj = path.parse(file.originalname);
            const videoName = originalFilenameObj.name.replace(/[^a-zA-Z0-9_\- ]/g, '');

            console.log(`[Job ${jobId}] Received file: ${inputPath}, Parts: ${numClips}. Adding to queue.`);
            taskQueue.push({ jobId, inputPath, numClips, movieName, videoName });
        });

        res.json({ message: 'Upload successful, batch processing queued', batchJobId, jobIds, originalNames });

        processNext();
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Server error during batch upload' });
    }
});

// 3. Vertical Video Endpoint
app.post('/api/create-vertical', upload.single('video'), (req, res) => {
    try {
        if (!req.file && !req.body.sourceUrl) return res.status(400).json({ error: 'No video uploaded or source provided' });

        const { jobId, blurEffect, blurIntensity, movieTitle, episodeNumber, sourceUrl, fontFamily, fontWeight } = req.body;

        if (!jobId) {
            return res.status(400).json({ error: 'Invalid jobId' });
        }

        let inputPath;
        let shouldDeleteInput = false;

        if (req.file) {
            inputPath = req.file.path;
            shouldDeleteInput = true;
        } else if (sourceUrl) {
            // sourceUrl should look like '/output/jobId/filename.mp4'
            const relativePath = sourceUrl.replace(/^\/output\//, '');
            inputPath = path.join(outputDir, relativePath);

            if (!inputPath.startsWith(outputDir) || !fs.existsSync(inputPath)) {
                return res.status(400).json({ error: 'Invalid source video file' });
            }
        }

        console.log(`[Job ${jobId}] Received vertical video request: ${inputPath}`);

        res.json({ message: 'Upload successful, vertical processing started', jobId });

        processVerticalVideo(jobId, inputPath, blurEffect === 'true', parseInt(blurIntensity) || 45, movieTitle, episodeNumber, shouldDeleteInput, fontFamily, fontWeight);

    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Server error during upload' });
    }
});

function processVerticalVideo(jobId, inputPath, blurEffect, blurIntensity, movieTitle, episodeNumber, shouldDeleteInput = true, fontFamily, fontWeight) {
    emitProgress(jobId, { status: 'processing', progress: 0, message: 'Analyzing video...' });

    let isFinished = false;
    let ffmpegCommand = null;

    const cleanupJob = () => {
        isFinished = true;
        if (shouldDeleteInput) {
            fs.unlink(inputPath, () => { });
        }
        if (jobs[jobId]) {
            if (jobs[jobId].clients) jobs[jobId].clients.forEach(c => c.end());
            delete jobs[jobId];
        }
    };

    const maxTimeout = setTimeout(() => {
        if (!isFinished) {
            console.error(`[Job ${jobId}] Processing timed out.`);
            isFinished = true;
            emitProgress(jobId, { status: 'error', message: 'Processing timed out' });
            if (ffmpegCommand) {
                try { ffmpegCommand.kill('SIGKILL'); } catch (e) { }
            }
            cleanupJob();
        }
    }, 120 * 60 * 1000); // 120 mins (2 hours) for rendering

    try {
        // Prepare FFmpeg complex filter
        let filterComplex = "";

        // Target is 1080x1920
        if (blurEffect) {
            const blurRadius = Math.max(5, Math.floor((blurIntensity / 100) * 50));
            // Create background scaled to fill 1080x1920 without preserving aspect ratio, then blur. Darken it a bit with eq=brightness.
            filterComplex += `[0:v]scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920,boxblur=${blurRadius}:${Math.ceil(blurRadius / 2)},eq=brightness=-0.3[bg];`;
            // Create foreground preserving aspect ratio, fit within 1080x1920
            filterComplex += `[0:v]scale=1080:1920:force_original_aspect_ratio=decrease[fg];`;
            // Overlay fg on bg
            filterComplex += `[bg][fg]overlay=(W-w)/2:(H-h)/2[base];`;
        } else {
            // Just place on a black background
            filterComplex += `color=c=black:s=1080x1920[bg];`;
            filterComplex += `[0:v]scale=1080:1920:force_original_aspect_ratio=decrease[fg];`;
            filterComplex += `[bg][fg]overlay=(W-w)/2:(H-h)/2[base];`;
        }

        let outStream = '[base]';

        let fontStr = '';
        if (fontFamily && fontFamily.trim() !== '') {
            fontStr = `font='${fontFamily.replace(/'/g, "")}':`;
        }

        // Add text overlays if present (simplified syntax avoiding strict escaping issues)
        if (movieTitle && movieTitle.trim() !== '') {
            // Very simplified drawtext. We cannot rely on specific fonts on arbitrary servers, so we omit fontfile to use default.
            filterComplex += `${outStream}drawtext=text='${movieTitle.replace(/'/g, "")}':${fontStr}fontsize=70:fontcolor=white:x=(w-text_w)/2:y=250:shadowcolor=black:shadowx=2:shadowy=2[withTitle];`;
            outStream = '[withTitle]';
        }

        if (episodeNumber && episodeNumber.trim() !== '') {
            filterComplex += `${outStream}drawtext=text='EPISODE #${episodeNumber.replace(/'/g, "")}':${fontStr}fontsize=40:fontcolor=#3b82f6:x=(w-text_w)/2:y=350:shadowcolor=black:shadowx=2:shadowy=2[withEp]`;
            outStream = '[withEp]';
        } else {
            // Remove lingering semicolon or bracket array assignment if no episode
            filterComplex = filterComplex.replace(/\[withTitle\];$/, '[withTitle]');
        }

        const jobOutputDir = path.join(outputDir, jobId);
        if (!fs.existsSync(jobOutputDir)) fs.mkdirSync(jobOutputDir);

        const outputFilename = `${jobId}_vertical.mp4`;
        const outputPath = path.join(jobOutputDir, outputFilename);

        ffmpeg.ffprobe(inputPath, (err, metadata) => {
            if (isFinished) return;
            try {
                const duration = metadata ? metadata.format.duration : 0;

                emitProgress(jobId, { status: 'processing', progress: 10, message: 'Rendering vertical video...' });

                ffmpegCommand = ffmpeg(inputPath)
                    .complexFilter(filterComplex, outStream.replace(/\[|\]/g, ''))
                    .outputOptions([
                        '-map 0:a?', // Explicitly map the audio stream since complexFilter drops it implicitly
                        '-c:v libx264',
                        '-preset ultrafast', // Use ultrafast for significantly faster rendering times
                        '-crf 23',
                        '-c:a copy', // Assuming audio is unaffected and compatible
                        '-movflags +faststart'
                    ])
                    .output(outputPath)
                    .on('progress', (progress) => {
                        if (duration > 0 && progress.timemark) {
                            const parts = progress.timemark.split(':');
                            let secs = 0;
                            if (parts.length === 3) {
                                secs = parseFloat(parts[0]) * 3600 + parseFloat(parts[1]) * 60 + parseFloat(parts[2]);
                            }
                            const percent = Math.min(99, Math.round(10 + (secs / duration) * 90));
                            emitProgress(jobId, { status: 'processing', progress: percent, message: 'Rendering video...' });
                        }
                    })
                    .on('end', () => {
                        if (isFinished) return;
                        console.log(`[Job ${jobId}] Vertical rendering finished.`);
                        clearTimeout(maxTimeout);

                        const clips = [{
                            name: outputFilename,
                            url: `/output/${jobId}/${outputFilename}`,
                            index: 1
                        }];

                        emitProgress(jobId, { status: 'completed', progress: 100, clips });
                        cleanupJob();
                    })
                    .on('error', (err) => {
                        if (isFinished) return;
                        console.error(`[Job ${jobId}] FFmpeg render error:`, err);
                        emitProgress(jobId, { status: 'error', message: 'Error rendering video' });
                        clearTimeout(maxTimeout);
                        cleanupJob();
                    })
                    .run();
            } catch (innerErr) {
                console.error(`[Job ${jobId}] Error in ffprobe callback:`, innerErr);
                if (!isFinished) {
                    emitProgress(jobId, { status: 'error', message: 'Internal server error during rendering' });
                    clearTimeout(maxTimeout);
                    cleanupJob();
                }
            }
        });
    } catch (err) {
        if (!isFinished) {
            console.error(`[Job ${jobId}] Unexpected error:`, err);
            emitProgress(jobId, { status: 'error', message: 'Unexpected server error' });
            clearTimeout(maxTimeout);
            cleanupJob();
        }
    }
}

function processVideo(jobId, inputPath, numClips, movieName, videoName) {
    emitProgress(jobId, { status: 'processing', progress: 0, message: 'Analyzing video...' });

    let isFinished = false;
    let ffmpegCommand = null;

    const cleanupJob = () => {
        isFinished = true;
        fs.unlink(inputPath, () => { });
        if (jobs[jobId]) {
            if (jobs[jobId].clients) jobs[jobId].clients.forEach(c => c.end());
            delete jobs[jobId];
        }
        isSplitting = false;
        processNext();
    };

    const maxTimeout = setTimeout(() => {
        if (!isFinished) {
            console.error(`[Job ${jobId}] Processing timed out.`);
            isFinished = true;
            emitProgress(jobId, { status: 'error', message: 'Processing timed out after 120 minutes' });
            if (ffmpegCommand) {
                try { ffmpegCommand.kill('SIGKILL'); } catch (e) { }
            }
            cleanupJob();
        }
    }, 120 * 60 * 1000); // 120 minutes (2 hours)

    try {
        // 1. Get total duration
        ffmpeg.ffprobe(inputPath, (err, metadata) => {
            if (isFinished) return;
            try {
                if (err) {
                    console.error(`[Job ${jobId}] ffprobe error:`, err);
                    clearTimeout(maxTimeout);
                    cleanupJob();
                    return emitProgress(jobId, { status: 'error', message: 'Failed to analyze video file' });
                }

                const duration = metadata.format.duration;
                if (!duration) {
                    clearTimeout(maxTimeout);
                    cleanupJob();
                    return emitProgress(jobId, { status: 'error', message: 'Could not determine video duration' });
                }

                const segmentLength = Math.ceil(duration / numClips);
                console.log(`[Job ${jobId}] Total duration: ${duration}s. Segment length: ${segmentLength}s`);

                // 2. Create job output directory
                let jobOutputDir;
                let relativeOutputDir;

                if (movieName && videoName) {
                    const safeMovieName = movieName.replace(/[^a-zA-Z0-9_\- ]/g, '').trim() || 'Untitled_Movie';
                    const safeVideoName = videoName.replace(/[^a-zA-Z0-9_\- ]/g, '').trim() || 'Untitled_Video';

                    const movieFolder = path.join(outputDir, safeMovieName);
                    if (!fs.existsSync(movieFolder)) fs.mkdirSync(movieFolder);

                    jobOutputDir = path.join(movieFolder, safeVideoName);
                    relativeOutputDir = `/output/${encodeURIComponent(safeMovieName)}/${encodeURIComponent(safeVideoName)}`;
                } else {
                    jobOutputDir = path.join(outputDir, jobId);
                    relativeOutputDir = `/output/${jobId}`;
                }

                if (fs.existsSync(jobOutputDir)) fs.rmSync(jobOutputDir, { recursive: true, force: true });
                fs.mkdirSync(jobOutputDir);

                const clipPrefix = videoName ? videoName.replace(/[^a-zA-Z0-9_\- ]/g, '').trim() : jobId;
                const outputPattern = path.join(jobOutputDir, `${clipPrefix}_clip_%02d` + path.extname(inputPath));

                emitProgress(jobId, { status: 'processing', progress: 10, message: 'Splitting video...' });

                // 3. Execute splitting
                ffmpegCommand = ffmpeg(inputPath)
                    .videoCodec('libx264')
                    .outputOptions([
                        '-f segment',
                        `-segment_time ${segmentLength}`,
                        '-reset_timestamps 1',
                        '-segment_start_number 1',
                        '-force_key_frames', `expr:gte(t,n_forced*${segmentLength})`, // Force keyframes exactly at segment boundaries
                        '-preset ultrafast', // Use ultrafast preset to minimize encoding time
                        '-crf 22', // Reasonable quality
                        '-c:a copy' // Audio can still be copied quickly
                    ])
                    .output(outputPattern)
                    .on('progress', (progress) => {
                        // approximate progress based on timemark
                        // progress.timemark is usually like "00:00:15.55"
                        if (progress.timemark) {
                            const parts = progress.timemark.split(':');
                            let secs = 0;
                            if (parts.length === 3) {
                                secs = parseFloat(parts[0]) * 3600 + parseFloat(parts[1]) * 60 + parseFloat(parts[2]);
                            }
                            const percent = Math.min(99, Math.round(10 + (secs / duration) * 90));
                            emitProgress(jobId, { status: 'processing', progress: percent, message: 'Splitting video...' });
                        }
                    })
                    .on('end', () => {
                        if (isFinished) return;
                        console.log(`[Job ${jobId}] Splitting finished.`);
                        clearTimeout(maxTimeout);

                        // Read generated files
                        fs.readdir(jobOutputDir, (err, files) => {
                            if (err) {
                                cleanupJob();
                                return emitProgress(jobId, { status: 'error', message: 'Failed to read output files' });
                            }

                            const clips = files.map((file, idx) => ({
                                name: file,
                                url: `${relativeOutputDir}/${encodeURIComponent(file)}`,
                                index: idx + 1
                            }));

                            emitProgress(jobId, { status: 'completed', progress: 100, clips });
                            cleanupJob();
                        });
                    })
                    .on('error', (err) => {
                        if (isFinished) return;
                        console.error(`[Job ${jobId}] FFmpeg error:`, err);
                        emitProgress(jobId, { status: 'error', message: 'Error during video splitting' });
                        clearTimeout(maxTimeout);
                        cleanupJob();
                    })
                    .run();
            } catch (innerErr) {
                console.error(`[Job ${jobId}] Error in ffprobe callback:`, innerErr);
                if (!isFinished) {
                    emitProgress(jobId, { status: 'error', message: 'Internal server error during processing' });
                    clearTimeout(maxTimeout);
                    cleanupJob();
                }
            }
        });
    } catch (err) {
        if (!isFinished) {
            console.error(`[Job ${jobId}] Unexpected error:`, err);
            emitProgress(jobId, { status: 'error', message: 'Unexpected server error' });
            clearTimeout(maxTimeout);
            cleanupJob();
        }
    }
}

// Cleanup old output directories and uploads
cron.schedule('0 * * * *', () => { // Run every hour
    console.log('Running directory cleanup task...');
    const now = Date.now();
    const MAX_AGE = 24 * 60 * 60 * 1000; // 24 hours

    // Cleanup output folder
    fs.readdir(outputDir, (err, folders) => {
        if (err) return console.error('Failed to read output dir for cleanup:', err);

        folders.forEach(folder => {
            const folderPath = path.join(outputDir, folder);
            fs.stat(folderPath, (err, stats) => {
                if (err) return;
                if (now - stats.mtimeMs > MAX_AGE) {
                    console.log(`Deleting old job output: ${folder}`);
                    fs.rm(folderPath, { recursive: true, force: true }, (err) => {
                        if (err) console.error(`Failed to delete ${folder}:`, err);
                    });
                }
            });
        });
    });

    // Cleanup uploads folder
    fs.readdir(uploadDir, (err, files) => {
        if (err) return console.error('Failed to read upload dir for cleanup:', err);

        files.forEach(file => {
            const filePath = path.join(uploadDir, file);
            fs.stat(filePath, (err, stats) => {
                if (err) return;
                if (now - stats.mtimeMs > MAX_AGE) {
                    console.log(`Deleting old upload file: ${file}`);
                    fs.unlink(filePath, (err) => {
                        if (err) console.error(`Failed to delete ${file}:`, err);
                    });
                }
            });
        });
    });
});

app.get('/api/download-zip/:jobId', (req, res) => {
    const { jobId } = req.params;
    const jobOutputDir = path.join(outputDir, jobId);

    if (!fs.existsSync(jobOutputDir)) {
        return res.status(404).json({ error: 'Job output not found' });
    }

    res.attachment(`${jobId}.zip`);
    const archive = archiver('zip', { zlib: { level: 9 } });

    archive.on('error', (err) => {
        console.error(`[Job ${jobId}] Zip error:`, err);
        res.status(500).end();
    });

    archive.pipe(res);
    archive.directory(jobOutputDir, false);
    archive.finalize();
});

app.get('/api/download-batch-zip', (req, res) => {
    const movieName = req.query.movieName;
    if (!movieName) return res.status(400).json({ error: 'movieName query param is required' });

    const safeMovieName = movieName.replace(/[^a-zA-Z0-9_\- ]/g, '').trim();
    if (!safeMovieName) return res.status(400).json({ error: 'Invalid movieName' });

    const movieFolder = path.join(outputDir, safeMovieName);

    if (!fs.existsSync(movieFolder)) {
        return res.status(404).json({ error: 'Output folder not found' });
    }

    res.attachment(`${safeMovieName}.zip`);
    const archive = archiver('zip', { zlib: { level: 9 } });

    archive.on('error', (err) => {
        console.error(`[Batch Zip ${safeMovieName}] error:`, err);
        res.status(500).end();
    });

    archive.pipe(res);
    archive.directory(movieFolder, false);
    archive.finalize();
});

const server = app.listen(port, () => {
    console.log(`Server is running on port ${port}`);
});

// Set server timeout to 2 hours (in milliseconds)
server.timeout = 120 * 60 * 1000;
