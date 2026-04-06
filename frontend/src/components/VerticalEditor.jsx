import React, { useState, useRef, useEffect } from 'react';
import axios from 'axios';
import { Layers, Type, Upload, Play, Pause, RotateCcw, RotateCw, Maximize, UploadCloud } from 'lucide-react';

const API_BASE_URL = import.meta.env.VITE_API_URL || 'http://localhost:5000';

export default function VerticalEditor({ initialVideo, batchClips }) {
    const [videoFile, setVideoFile] = useState(initialVideo || null);

    const [batchMode, setBatchMode] = useState(false);
    const [currentBatchIndex, setCurrentBatchIndex] = useState(0);
    const [batchResults, setBatchResults] = useState([]);

    useEffect(() => {
        if (initialVideo) {
            setVideoFile(initialVideo);
            setStatus('idle');
            setOutputUrl(null);
            if (batchClips && batchClips.length > 0) {
                setBatchMode(true);
            } else {
                setBatchMode(false);
            }
        }
    }, [initialVideo, batchClips]);
    const [blurEffect, setBlurEffect] = useState(true);
    const [blurIntensity, setBlurIntensity] = useState(45);
    const [movieTitle, setMovieTitle] = useState('Movie title');
    const [episodeNumber, setEpisodeNumber] = useState('1');
    const [fontFamily, setFontFamily] = useState('Public Sans');
    const [fontWeight, setFontWeight] = useState('Black Italic');
    const [format] = useState('MP4 (H.264)');
    const [resolution] = useState('1080 x 1920 (9:16)');
    const [status, setStatus] = useState('idle'); // idle, processing, batch_processing, completed, batch_completed, error
    const [progress, setProgress] = useState(0);
    const [message, setMessage] = useState('');
    const [outputUrl, setOutputUrl] = useState(null);

    const [isPlaying, setIsPlaying] = useState(false);
    const [currentTime, setCurrentTime] = useState(0);
    const [duration, setDuration] = useState(0);

    const videoRef = useRef(null);
    const bgVideoRef = useRef(null);

    const handleFileChange = (e) => {
        if (e.target.files && e.target.files[0]) {
            const file = e.target.files[0];
            const url = URL.createObjectURL(file);
            setVideoFile({ file, url });
            setStatus('idle'); // Reset status on new file upload
            setOutputUrl(null);
            setBatchMode(false);
        }
    };

    const handlePlayPause = () => {
        if (videoRef.current) {
            if (isPlaying) {
                videoRef.current.pause();
                if (bgVideoRef.current) bgVideoRef.current.pause();
            } else {
                videoRef.current.play();
                if (bgVideoRef.current) bgVideoRef.current.play();
            }
            setIsPlaying(!isPlaying);
        }
    };

    const handleTimeUpdate = () => {
        if (videoRef.current) {
            setCurrentTime(videoRef.current.currentTime);
            // Sync bg video
            if (bgVideoRef.current && Math.abs(bgVideoRef.current.currentTime - videoRef.current.currentTime) > 0.5) {
                bgVideoRef.current.currentTime = videoRef.current.currentTime;
            }
        }
    };

    const handleLoadedMetadata = () => {
        if (videoRef.current) {
            setDuration(videoRef.current.duration);
        }
    };

    const skip = (amount) => {
        if (videoRef.current) {
            videoRef.current.currentTime += amount;
            if (bgVideoRef.current) bgVideoRef.current.currentTime = videoRef.current.currentTime;
        }
    };

    const formatTime = (time) => {
        const min = Math.floor(time / 60);
        const sec = Math.floor(time % 60);
        return `${min.toString().padStart(2, '0')}:${sec.toString().padStart(2, '0')}`;
    };

    const startBatchExport = async () => {
        if (!batchClips || batchClips.length === 0) return;
        setStatus('batch_processing');
        setCurrentBatchIndex(0);
        setBatchResults([]);

        let results = [];
        for (let i = 0; i < batchClips.length; i++) {
            const currentClip = batchClips[i];
            setCurrentBatchIndex(i);
            setProgress(0);
            setMessage(`Processing clip ${i + 1} of ${batchClips.length}...`);

            try {
                const url = await processSingleClip(currentClip, i);
                results.push({ name: currentClip.name, url });
            } catch (e) {
                console.error(e);
                setStatus('error');
                setMessage(`Error on clip ${i + 1}: ${e.message || 'Error occurred.'}`);
                return;
            }
        }

        setStatus('batch_completed');
        setBatchResults(results);
    };

    const processSingleClip = (clip, index) => {
        return new Promise(async (resolve, reject) => {
            const baseName = (clip.file ? clip.file.name : clip.name).replace(/\.[^/.]+$/, "").replace(/[^a-zA-Z0-9]/g, '_').replace(/_+/g, '_').replace(/_$/, '');
            const newJobId = (baseName || 'job') + '_vertical_batch_' + Date.now() + '_' + index;

            const formData = new FormData();
            if (clip.sourceUrl) {
                formData.append('sourceUrl', clip.sourceUrl);
            } else if (clip.file) {
                formData.append('video', clip.file);
            }

            formData.append('jobId', newJobId);
            formData.append('blurEffect', blurEffect);
            formData.append('blurIntensity', blurIntensity);
            formData.append('movieTitle', movieTitle);
            formData.append('episodeNumber', episodeNumber);
            formData.append('fontFamily', fontFamily);
            formData.append('fontWeight', fontWeight);

            try {
                await axios.post(`${API_BASE_URL}/api/create-vertical`, formData, {
                    headers: { 'Content-Type': 'multipart/form-data' }
                });

                const eventSource = new EventSource(`${API_BASE_URL}/api/progress/${newJobId}`);
                eventSource.onmessage = (event) => {
                    const data = JSON.parse(event.data);
                    if (data.status === 'processing') {
                        setProgress(data.progress || 0);
                        setMessage(`Processing clip ${index + 1} of ${batchClips.length}: ${data.message || '...'}`);
                    } else if (data.status === 'completed') {
                        eventSource.close();
                        if (data.clips && data.clips.length > 0) {
                            resolve(data.clips[0].url);
                        } else {
                            resolve(null);
                        }
                    } else if (data.status === 'error') {
                        eventSource.close();
                        reject(new Error(data.message || 'Error occurred.'));
                    }
                };
            } catch (err) {
                reject(err);
            }
        });
    };

    const handleExport = async () => {
        if (!videoFile) return;

        setStatus('processing');
        setProgress(0);
        setMessage('Uploading video...');

        // Generate an ID for this job
        const baseName = (videoFile.file ? videoFile.file.name : videoFile.name).replace(/\.[^/.]+$/, "").replace(/[^a-zA-Z0-9]/g, '_').replace(/_+/g, '_').replace(/_$/, '');
        const newJobId = (baseName || 'job') + '_vertical_' + Date.now();

        const formData = new FormData();

        if (videoFile.sourceUrl) {
            formData.append('sourceUrl', videoFile.sourceUrl);
        } else if (videoFile.file) {
            formData.append('video', videoFile.file);
        }

        formData.append('jobId', newJobId);
        formData.append('blurEffect', blurEffect);
        formData.append('blurIntensity', blurIntensity);
        formData.append('movieTitle', movieTitle);
        formData.append('episodeNumber', episodeNumber);
        formData.append('fontFamily', fontFamily);
        formData.append('fontWeight', fontWeight);

        try {
            await axios.post(`${API_BASE_URL}/api/create-vertical`, formData, {
                headers: { 'Content-Type': 'multipart/form-data' },
                onUploadProgress: (evt) => {
                    const percentCompleted = Math.round((evt.loaded * 100) / evt.total);
                    setProgress(Math.floor(percentCompleted * 0.1)); // Max 10% for upload
                }
            });

            // Connect to SSE for progress
            const eventSource = new EventSource(`${API_BASE_URL}/api/progress/${newJobId}`);
            eventSource.onmessage = (event) => {
                const data = JSON.parse(event.data);
                if (data.status === 'processing') {
                    setProgress(data.progress || 0);
                    setMessage(data.message || 'Processing...');
                } else if (data.status === 'completed') {
                    setStatus('completed');
                    setProgress(100);
                    setMessage('Export completed!');
                    if (data.clips && data.clips.length > 0) {
                        setOutputUrl(data.clips[0].url);
                    }
                    eventSource.close();
                } else if (data.status === 'error') {
                    setStatus('error');
                    setMessage(data.message || 'Error occurred.');
                    eventSource.close();
                }
            };

        } catch (err) {
            console.error(err);
            setStatus('error');
            setMessage(err.response?.data?.error || 'Failed to upload video');
        }
    };

    return (
        <div className="max-w-7xl mx-auto px-4 py-8 flex flex-col lg:flex-row gap-8 pb-20">

            {/* Left Area: Canvas Preview */}
            <div className="flex-1 flex justify-center items-start">
                <div className="bg-gray-100 rounded-2xl p-4 shadow-inner flex items-center justify-center relative overflow-hidden" style={{ minWidth: '360px', width: '400px', height: '100%', minHeight: '800px' }}>

                    {!videoFile ? (
                        <div className="text-center">
                            <input type="file" id="video-upload" className="hidden" accept="video/*" onChange={handleFileChange} />
                            <label htmlFor="video-upload" className="cursor-pointer flex flex-col items-center">
                                <div className="w-16 h-16 bg-indigo-100 text-indigo-500 rounded-full flex items-center justify-center mb-4 hover:scale-105 transition-transform">
                                    <UploadCloud className="w-8 h-8" />
                                </div>
                                <h3 className="text-lg font-bold text-gray-700">Upload Video</h3>
                                <p className="text-sm text-gray-500">to start editing</p>
                            </label>
                        </div>
                    ) : (
                        <div className="relative w-full h-full bg-black rounded-xl overflow-hidden shadow-2xl flex flex-col aspect-[9/16]">
                            {/* Blurred Background Layer */}
                            {blurEffect && (
                                <video
                                    ref={bgVideoRef}
                                    src={videoFile.url}
                                    className="absolute inset-0 w-full h-full object-cover opacity-60 pointer-events-none"
                                    style={{ filter: `blur(${blurIntensity / 2}px) brightness(0.6)` }}
                                    muted
                                    playsInline
                                />
                            )}

                            {/* Main Video Layer */}
                            <div className="absolute inset-0 flex items-center justify-center z-10 pointer-events-none">
                                <video
                                    ref={videoRef}
                                    src={videoFile.url}
                                    className="w-full h-auto object-contain pointer-events-none"
                                    onTimeUpdate={handleTimeUpdate}
                                    onLoadedMetadata={handleLoadedMetadata}
                                    onEnded={() => setIsPlaying(false)}
                                    muted // Muted for preview to prevent noise, can be configurable
                                    playsInline
                                />
                            </div>

                            {/* Safe Area & Text Overlays */}
                            <div className="absolute inset-0 z-20 pointer-events-none p-6">
                                <div className="w-full h-full border border-dashed border-white/30 rounded-lg relative pointer-events-none">
                                    <div className="absolute top-2 left-0 right-0 text-center">
                                        <span className="text-[10px] font-bold tracking-widest text-white/50 uppercase">Safe Area</span>
                                    </div>

                                    {/* Text Overlay Group */}
                                    <div className="absolute top-20 left-0 right-0 text-center px-4 drop-shadow-lg">
                                        {movieTitle && (
                                            <h2 className="text-white text-3xl font-extrabold mb-1" style={{ fontFamily: fontFamily === 'Public Sans' ? '"Public Sans", sans-serif' : 'sans-serif' }}>
                                                {movieTitle}
                                            </h2>
                                        )}
                                        {episodeNumber && (
                                            <h3 className="text-blue-500 text-lg font-bold uppercase tracking-wider">
                                                EPISODE #{episodeNumber}
                                            </h3>
                                        )}
                                    </div>
                                </div>
                            </div>

                            {/* Custom Player Controls */}
                            <div className="absolute bottom-0 left-0 right-0 p-6 z-30 bg-gradient-to-t from-black/80 to-transparent">
                                <div className="flex items-center justify-between text-white mb-2">
                                    <div className="flex items-center gap-4">
                                        <button onClick={() => skip(-10)} className="hover:text-blue-400 transition-colors">
                                            <RotateCcw className="w-5 h-5" />
                                        </button>

                                        <button onClick={handlePlayPause} className="w-12 h-12 bg-blue-500 hover:bg-blue-600 rounded-full flex items-center justify-center pl-1 transition-colors pointer-events-auto">
                                            {isPlaying ? <Pause className="w-6 h-6" /> : <Play className="w-6 h-6" />}
                                        </button>

                                        <button onClick={() => skip(10)} className="hover:text-blue-400 transition-colors">
                                            <RotateCw className="w-5 h-5" />
                                        </button>
                                    </div>

                                    <div className="flex items-center gap-4 text-sm font-mono opacity-90">
                                        <span>{formatTime(currentTime)} / {formatTime(duration)}</span>
                                        <button className="hover:text-blue-400 transition-colors">
                                            <Maximize className="w-5 h-5" />
                                        </button>
                                    </div>
                                </div>
                            </div>

                        </div>
                    )}
                </div>
            </div>

            {/* Right Area: Properties Panel */}
            <div className="w-full lg:w-[400px] bg-white border border-gray-100 rounded-2xl shadow-sm p-6 flex flex-col gap-8 h-fit">

                {/* Background Settings */}
                <section>
                    <div className="flex items-center gap-2 text-blue-500 mb-6 uppercase text-sm font-bold tracking-wider">
                        <Layers className="w-4 h-4" /> Background
                    </div>

                    <div className="flex items-center justify-between mb-4">
                        <span className="font-semibold text-gray-800">Blur Effect</span>
                        <button
                            onClick={() => setBlurEffect(!blurEffect)}
                            className={`w-12 h-6 rounded-full p-1 transition-colors ${blurEffect ? 'bg-blue-500' : 'bg-gray-300'}`}
                        >
                            <div className={`w-4 h-4 rounded-full bg-white transition-transform ${blurEffect ? 'translate-x-6' : 'translate-x-0'}`} />
                        </button>
                    </div>

                    <div className={`transition-opacity ${blurEffect ? 'opacity-100' : 'opacity-50 pointer-events-none'}`}>
                        <div className="flex justify-between items-center mb-2">
                            <label className="text-xs font-bold text-gray-500 uppercase">Intensity</label>
                            <span className="text-xs font-bold text-gray-500">{blurIntensity}%</span>
                        </div>
                        <input
                            type="range"
                            min="0" max="100"
                            value={blurIntensity}
                            onChange={(e) => setBlurIntensity(Math.max(10, parseInt(e.target.value)))}
                            className="w-full h-1.5 bg-gray-200 rounded-lg appearance-none cursor-pointer accent-blue-500"
                        />
                    </div>
                </section>

                <hr className="border-gray-100" />

                {/* Text Overlays */}
                <section>
                    <div className="flex items-center gap-2 text-blue-500 mb-6 uppercase text-sm font-bold tracking-wider">
                        <Type className="w-4 h-4" /> Text Overlays
                    </div>

                    <div className="space-y-5">
                        <div>
                            <label className="block text-xs font-bold text-gray-500 uppercase mb-2">Main Title</label>
                            <input
                                type="text"
                                value={movieTitle}
                                onChange={(e) => setMovieTitle(e.target.value)}
                                className="w-full text-2xl font-bold bg-gray-50 border border-gray-100 rounded-xl px-4 py-3 focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500"
                            />
                        </div>

                        <div>
                            <label className="block text-xs font-bold text-gray-500 uppercase mb-2">Episode Number</label>
                            <div className="flex">
                                <div className="bg-gray-50 border border-gray-100 border-r-0 rounded-l-xl px-4 py-2 flex items-center text-gray-400 font-bold">#</div>
                                <input
                                    type="text"
                                    value={episodeNumber}
                                    onChange={(e) => setEpisodeNumber(e.target.value)}
                                    className="w-full bg-gray-50 border border-gray-100 rounded-r-xl px-4 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 font-medium"
                                />
                            </div>
                        </div>

                        <div className="flex gap-4">
                            <div className="flex-1">
                                <label className="block text-xs font-bold text-gray-500 uppercase mb-2">Font</label>
                                <select
                                    value={fontFamily}
                                    onChange={(e) => setFontFamily(e.target.value)}
                                    className="w-full bg-gray-50 border border-gray-100 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-blue-500"
                                >
                                    <option>Public Sans</option>
                                    <option>Inter</option>
                                    <option>Outfit</option>
                                </select>
                            </div>
                            <div className="flex-1">
                                <label className="block text-xs font-bold text-gray-500 uppercase mb-2">Weight</label>
                                <select
                                    value={fontWeight}
                                    onChange={(e) => setFontWeight(e.target.value)}
                                    className="w-full bg-gray-50 border border-gray-100 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-blue-500"
                                >
                                    <option>Black Italic</option>
                                    <option>Bold</option>
                                    <option>Normal</option>
                                </select>
                            </div>
                        </div>
                    </div>
                </section>

                <hr className="border-gray-100" />

                {/* Export Settings */}
                <section>
                    <div className="flex items-center gap-2 text-blue-500 mb-6 uppercase text-sm font-bold tracking-wider">
                        <Layers className="w-4 h-4" /> Export Settings
                    </div>

                    <div className="space-y-4 mb-8">
                        <div className="bg-gray-50 border border-gray-100 rounded-xl p-4 flex justify-between items-center cursor-pointer hover:border-gray-200">
                            <div>
                                <span className="block font-semibold text-gray-800">Format</span>
                                <span className="text-xs text-gray-500">{format}</span>
                            </div>
                            <span className="text-gray-400">▼</span>
                        </div>

                        <div className="bg-gray-50 border border-gray-100 rounded-xl p-4 flex justify-between items-center cursor-pointer hover:border-gray-200">
                            <div>
                                <span className="block font-semibold text-gray-800">Resolution</span>
                                <span className="text-xs text-gray-500">{resolution}</span>
                            </div>
                            <span className="text-gray-400">▼</span>
                        </div>
                    </div>

                    {status === 'batch_processing' ? (
                        <div className="w-full bg-white border border-gray-100 p-4 rounded-xl text-center">
                            <p className="text-purple-500 font-bold mb-2">{message}</p>
                            <div className="w-full bg-gray-200 rounded-full h-2 mb-2">
                                <div className="bg-purple-500 h-2 rounded-full transition-all" style={{ width: `${progress}%` }}></div>
                            </div>
                            <p className="text-xs text-gray-500">{progress}% | Clip {currentBatchIndex + 1} of {batchClips.length}</p>
                        </div>
                    ) : status === 'batch_completed' && batchResults.length > 0 ? (
                        <div className="w-full bg-white border border-gray-100 p-4 rounded-xl">
                            <h3 className="text-green-500 font-bold mb-3 text-center">Batch Processing Complete!</h3>
                            <div className="flex flex-col gap-2 max-h-48 overflow-y-auto">
                                {batchResults.map((res, i) => (
                                    <a key={i} href={`${API_BASE_URL}${res.url}`} download target="_blank" rel="noreferrer" className="text-sm text-blue-500 hover:underline flex justify-between bg-gray-50 p-2 rounded">
                                        <span className="truncate mr-4">{res.name}</span>
                                        <span className="font-bold">Download</span>
                                    </a>
                                ))}
                            </div>
                        </div>
                    ) : status === 'processing' ? (
                        <div className="w-full bg-white border border-gray-100 p-4 rounded-xl text-center">
                            <p className="text-blue-500 font-bold mb-2">{message}</p>
                            <div className="w-full bg-gray-200 rounded-full h-2 mb-2">
                                <div className="bg-blue-500 h-2 rounded-full transition-all" style={{ width: `${progress}%` }}></div>
                            </div>
                            <p className="text-xs text-gray-500">{progress}%</p>
                        </div>
                    ) : status === 'completed' && outputUrl ? (
                        <a
                            href={`${API_BASE_URL}${outputUrl}`}
                            download
                            target="_blank"
                            rel="noreferrer"
                            className="w-full py-4 rounded-xl font-bold text-white shadow-lg transition-all bg-green-500 hover:bg-green-600 block text-center"
                        >
                            Download Finished Video
                        </a>
                    ) : (
                        <div>
                            {status === 'error' && <p className="text-red-500 text-sm mb-2 text-center">{message}</p>}
                            {batchMode ? (
                                <button
                                    onClick={startBatchExport}
                                    className={`w-full py-4 rounded-xl font-bold text-white shadow-lg transition-all ${videoFile ? 'bg-purple-600 hover:bg-purple-700 hover:shadow-purple-500/30' : 'bg-gray-300 cursor-not-allowed shadow-none'}`}
                                    disabled={!videoFile}
                                >
                                    Batch Export All Clips ({batchClips.length})
                                </button>
                            ) : (
                                <button
                                    onClick={handleExport}
                                    className={`w-full py-4 rounded-xl font-bold text-white shadow-lg transition-all ${videoFile ? 'bg-blue-500 hover:bg-blue-600 hover:shadow-blue-500/30' : 'bg-gray-300 cursor-not-allowed shadow-none'}`}
                                    disabled={!videoFile}
                                >
                                    Export Vertical Video
                                </button>
                            )}
                        </div>
                    )}
                </section>

            </div>
        </div>
    );
}
