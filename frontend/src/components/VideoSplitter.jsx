import React, { useState, useRef, useEffect } from 'react';
import { UploadCloud, FileVideo, Scissors, Download, X, AlertCircle, CheckCircle, FolderArchive, Smartphone } from 'lucide-react';
import axios from 'axios';
import { motion, AnimatePresence } from 'framer-motion';

const API_BASE_URL = import.meta.env.VITE_API_URL || 'http://localhost:5000';
const API_BASE = `${API_BASE_URL}/api`;

export default function VideoSplitter({ onEditClip, onEditBatchClip }) {
  const [files, setFiles] = useState([]);
  const [numClips, setNumClips] = useState(2);
  const [movieName, setMovieName] = useState('');
  const [status, setStatus] = useState('idle'); // idle, processing, completed, error
  const [progress, setProgress] = useState(0);
  const [message, setMessage] = useState('');
  const [clips, setClips] = useState([]);

  const [batchJobs, setBatchJobs] = useState([]);
  const [batchJobId, setBatchJobId] = useState(null);

  const [isDragging, setIsDragging] = useState(false);

  const fileInputRef = useRef(null);
  const activeSourcesRef = useRef({});

  useEffect(() => {
    if (status !== 'processing' || batchJobs.length === 0) return;

    batchJobs.forEach((job) => {
      if (job.status === 'completed' || job.status === 'error') {
        if (activeSourcesRef.current[job.jobId]) {
          activeSourcesRef.current[job.jobId].close();
          delete activeSourcesRef.current[job.jobId];
        }
        return;
      }
      if (!activeSourcesRef.current[job.jobId]) {
        const eventSource = new EventSource(`${API_BASE}/progress/${encodeURIComponent(job.jobId)}`);
        activeSourcesRef.current[job.jobId] = eventSource;

        eventSource.onmessage = (event) => {
          const data = JSON.parse(event.data);
          setBatchJobs(prev => {
            const newJobs = [...prev];
            const jobIdx = newJobs.findIndex(j => j.jobId === job.jobId);
            if (jobIdx === -1) return prev;

            const currentJob = { ...newJobs[jobIdx] };
            if (data.status === 'processing') {
              currentJob.progress = data.progress || 0;
              currentJob.message = data.message || 'Processing...';
              currentJob.status = 'processing';
            } else if (data.status === 'completed') {
              currentJob.progress = 100;
              currentJob.status = 'completed';
              currentJob.clips = data.clips || [];
              if (activeSourcesRef.current[job.jobId]) {
                activeSourcesRef.current[job.jobId].close();
                delete activeSourcesRef.current[job.jobId];
              }
            } else if (data.status === 'error') {
              currentJob.status = 'error';
              currentJob.message = data.message || 'Error occurred.';
              if (activeSourcesRef.current[job.jobId]) {
                activeSourcesRef.current[job.jobId].close();
                delete activeSourcesRef.current[job.jobId];
              }
            }
            newJobs[jobIdx] = currentJob;
            return newJobs;
          });
        };

        eventSource.onerror = (err) => {
          console.error("SSE Error for job", job.jobId, err);
        };
      }
    });

    return () => {
      if (status !== 'processing') {
        Object.values(activeSourcesRef.current).forEach(es => es.close());
        activeSourcesRef.current = {};
      }
    };
  }, [status, batchJobs]);

  useEffect(() => {
    if (status !== 'processing' || batchJobs.length === 0) return;

    const totalJobs = batchJobs.length;
    const completedJobs = batchJobs.filter(j => j.status === 'completed').length;
    const errorJobs = batchJobs.filter(j => j.status === 'error').length;

    let currentJobProgress = 0;
    const processingJob = batchJobs.find(j => j.status === 'processing');
    if (processingJob) currentJobProgress = processingJob.progress;

    const totalProgress = Math.floor(((completedJobs * 100) + currentJobProgress) / totalJobs);

    // Only update progress and messages if not yet fully completed
    setProgress(totalProgress);

    if (processingJob) {
      setMessage(`Processing video ${completedJobs + 1} of ${totalJobs}: ${processingJob.originalName}...`);
    } else if (completedJobs + errorJobs === totalJobs) {
      if (errorJobs === totalJobs) {
        setStatus('error');
        setMessage('All videos failed to process.');
      } else {
        setStatus('completed');
        setMessage('Splitting complete for all videos!');

        const allClips = [];
        batchJobs.forEach(j => {
          if (j.clips) {
            allClips.push(...j.clips.map(c => ({
              ...c,
              originalJob: j.originalName
            })));
          }
        });
        setClips(allClips);
      }
    }
  }, [batchJobs, status]);

  const handleDragOver = (e) => {
    e.preventDefault();
    if (status !== 'idle') return;
    setIsDragging(true);
  };

  const handleDragLeave = (e) => {
    e.preventDefault();
    setIsDragging(false);
  };

  const handleDrop = (e) => {
    e.preventDefault();
    setIsDragging(false);
    if (status !== 'idle') return;

    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      handleFileSelection(Array.from(e.dataTransfer.files));
    }
  };

  const handleFileChange = (e) => {
    if (e.target.files && e.target.files.length > 0) {
      handleFileSelection(Array.from(e.target.files));
    }
  };

  const handleFileSelection = (selectedFiles) => {
    const validFiles = selectedFiles.filter(f => f.type.startsWith('video/'));
    if (validFiles.length === 0) {
      setStatus('error');
      setMessage('Please upload valid video files.');
      return;
    }

    setFiles(prev => [...prev, ...validFiles]);
    setStatus('idle');
    setMessage('');
    setClips([]);
    setProgress(0);
  };

  const removeFile = (indexToRemove) => {
    setFiles(files.filter((_, idx) => idx !== indexToRemove));
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const handleSplit = async () => {
    if (files.length === 0) return;

    setStatus('processing');
    setProgress(0);
    setMessage('Uploading videos...');

    const newBatchJobId = 'batch_' + Date.now();
    setBatchJobId(newBatchJobId);

    const formData = new FormData();
    files.forEach(file => {
      formData.append('videos', file);
    });
    formData.append('numClips', numClips);
    formData.append('batchJobId', newBatchJobId);
    formData.append('movieName', movieName.trim() || newBatchJobId);

    try {
      const resp = await axios.post(`${API_BASE}/split-videos-batch`, formData, {
        headers: { 'Content-Type': 'multipart/form-data' },
        onUploadProgress: (evt) => {
          const percentCompleted = Math.round((evt.loaded * 100) / evt.total);
          setProgress(Math.floor(percentCompleted * 0.1));
        }
      });

      const jobIds = resp.data.jobIds;
      const originalNames = resp.data.originalNames;

      const initialJobs = jobIds.map(id => ({
        jobId: id,
        originalName: originalNames[id],
        status: 'waiting',
        progress: 0,
        message: 'Waiting in queue...'
      }));
      setBatchJobs(initialJobs);

    } catch (err) {
      console.error(err);
      setStatus('error');
      setMessage(err.response?.data?.error || 'Failed to upload videos');
    }
  };

  const reset = () => {
    setFiles([]);
    setNumClips(2);
    setMovieName('');
    setStatus('idle');
    setProgress(0);
    setMessage('');
    setClips([]);
    setBatchJobs([]);
    setBatchJobId(null);
  };

  return (
    <div className="min-h-screen font-sans bg-gray-50 text-gray-900 pb-20">
      <header className="bg-white shadow-sm sticky top-0 z-10">
        <div className="max-w-5xl mx-auto px-4 py-4 flex items-center justify-between">
          <div className="flex items-center space-x-2 text-indigo-600">
            <Scissors className="w-8 h-8" />
            <h1 className="text-2xl font-bold tracking-tight">VideoCutter</h1>
          </div>
          <p className="text-sm font-medium text-gray-500 hidden sm:block">Seamlessly split your long videos.</p>
        </div>
      </header>

      <main className="max-w-3xl mx-auto px-4 mt-10">
        {/* Upload Area */}
        <div
          className={`relative border-2 border-dashed rounded-xl p-8 md:p-12 text-center transition-colors duration-200 ease-in-out ${isDragging ? 'border-indigo-500 bg-indigo-50' : 'border-gray-300 bg-white hover:border-indigo-400'
            } ${(status === 'processing' || status === 'completed') ? 'opacity-50 pointer-events-none' : ''}`}
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          onDrop={handleDrop}
        >
          <input
            type="file"
            multiple
            ref={fileInputRef}
            onChange={handleFileChange}
            className="hidden"
            accept="video/*"
            disabled={status !== 'idle'}
          />

          <AnimatePresence mode="wait">
            {files.length === 0 ? (
              <motion.div
                key="empty"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                className="flex flex-col items-center cursor-pointer"
                onClick={() => fileInputRef.current?.click()}
              >
                <div className="p-4 bg-indigo-50 text-indigo-500 rounded-full mb-4">
                  <UploadCloud className="w-8 h-8" />
                </div>
                <h3 className="text-lg font-semibold text-gray-800">Drag & drop your videos here</h3>
                <p className="text-sm text-gray-500 mt-2">or click to browse files (MP4, MOV, WebM)</p>
              </motion.div>
            ) : (
              <motion.div
                key="files"
                initial={{ scale: 0.95, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                className="flex flex-col"
              >
                <div className="flex justify-between items-center mb-4">
                  <p className="text-emerald-600 font-medium flex items-center gap-1 text-sm bg-emerald-50 px-3 py-1 rounded-full">
                    <CheckCircle className="w-4 h-4" /> Ready to split {files.length} video{files.length !== 1 ? 's' : ''}
                  </p>
                  {(status === 'idle') && (
                    <button onClick={() => setFiles([])} className="text-sm text-gray-500 hover:text-red-500 transition-colors">Clear All</button>
                  )}
                </div>
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
                  {files.map((f, idx) => (
                    <div key={idx} className="flex flex-col items-center relative p-4 bg-gray-50 rounded-lg border border-gray-100 shadow-sm">
                      {(status === 'idle') && (
                        <button onClick={(e) => { e.stopPropagation(); removeFile(idx); }} className="absolute -top-2 -right-2 bg-gray-200 hover:bg-gray-300 text-gray-700 rounded-full p-1 z-10" title="Remove video">
                          <X className="w-4 h-4" />
                        </button>
                      )}
                      <FileVideo className="w-8 h-8 text-indigo-500 mb-2" />
                      <h3 className="text-xs font-medium text-gray-800 break-all text-center line-clamp-2" title={f.name}>{f.name}</h3>
                      <p className="text-xs text-gray-500 mt-1">{(f.size / (1024 * 1024)).toFixed(2)} MB</p>
                    </div>
                  ))}
                  {status === 'idle' && (
                    <div onClick={() => fileInputRef.current?.click()} className="flex flex-col items-center justify-center cursor-pointer p-4 border-2 border-dashed border-gray-300 rounded-lg text-gray-500 hover:bg-gray-50 hover:text-indigo-500 hover:border-indigo-400 transition-colors min-h-[100px]">
                      <UploadCloud className="w-6 h-6 mb-1" />
                      <span className="text-xs font-medium">Add more</span>
                    </div>
                  )}
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        {/* Status Messages */}
        <AnimatePresence>
          {status === 'error' && (
            <motion.div
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: 'auto', opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              className="mt-4 p-4 bg-red-50 text-red-700 rounded-lg flex items-center gap-3 overflow-hidden"
            >
              <AlertCircle className="w-5 h-5 flex-shrink-0" />
              <p>{message}</p>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Controls */}
        <div className={`mt-8 bg-white p-6 md:p-8 rounded-xl shadow-sm border border-gray-100 transition-opacity duration-300 ${(files.length === 0 || status !== 'idle') ? 'opacity-50 pointer-events-none' : 'opacity-100'}`}>
          <div className="mb-8">
            <label className="block text-gray-700 font-semibold mb-2 text-lg">
              Movie / Project Name (Main Folder)
            </label>
            <input
              type="text"
              placeholder="e.g. My Awesome Video"
              value={movieName}
              onChange={(e) => setMovieName(e.target.value)}
              className="w-full sm:w-1/2 p-3 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500"
            />
          </div>

          <label className="block text-gray-700 font-semibold mb-4 text-lg">
            How many clips do you want per video?
          </label>
          <div className="flex flex-col sm:flex-row items-center gap-6">
            <input
              type="range"
              min="2"
              max="20"
              value={numClips}
              onChange={(e) => setNumClips(parseInt(e.target.value))}
              className="w-full h-2 bg-gray-200 rounded-lg appearance-none cursor-pointer accent-indigo-600"
            />
            <div className="flex items-center">
              <button
                onClick={() => setNumClips(Math.max(2, numClips - 1))}
                className="w-10 h-10 border border-gray-300 rounded-l-lg flex justify-center items-center hover:bg-gray-50 text-gray-600"
              >
                -
              </button>
              <input
                type="number"
                min="2"
                max="20"
                value={numClips}
                onChange={(e) => setNumClips(parseInt(e.target.value) || 2)}
                className="w-16 h-10 border-y border-gray-300 text-center font-semibold text-lg focus:outline-none focus:ring-1 focus:ring-indigo-500 z-10"
              />
              <button
                onClick={() => setNumClips(Math.min(20, numClips + 1))}
                className="w-10 h-10 border border-gray-300 rounded-r-lg flex justify-center items-center hover:bg-gray-50 text-gray-600"
              >
                +
              </button>
            </div>
          </div>
        </div>

        {/* Action Button */}
        <div className="mt-8 flex justify-center">
          {status === 'idle' || status === 'error' ? (
            <button
              onClick={handleSplit}
              disabled={files.length === 0}
              className={`w-full sm:w-auto px-10 py-4 rounded-full text-lg font-semibold text-white shadow-lg transition-all duration-200 flex items-center justify-center gap-2
                ${files.length > 0 ? 'bg-indigo-600 hover:bg-indigo-700 hover:shadow-indigo-500/30' : 'bg-gray-300 cursor-not-allowed shadow-none'}
              `}
            >
              <Scissors className="w-5 h-5" />
              Split {files.length > 0 ? `${files.length} Video${files.length > 1 ? 's' : ''}` : 'Video'}
            </button>
          ) : status === 'processing' ? (
            <div className="w-full bg-white p-6 rounded-xl shadow-sm border border-gray-100 text-center">
              <p className="text-indigo-600 font-medium mb-3">{message}</p>
              <div className="w-full bg-gray-200 rounded-full h-3 mb-2 overflow-hidden">
                <div className="bg-indigo-600 h-3 rounded-full transition-all duration-300 ease-out" style={{ width: `${progress}%` }}></div>
              </div>
              <p className="text-sm text-gray-500">{progress}% Overall Progress</p>
            </div>
          ) : (
            <button
              onClick={reset}
              className="px-8 py-3 bg-white border-2 border-indigo-600 text-indigo-600 font-semibold rounded-full hover:bg-indigo-50 transition-colors"
            >
              Split Another Batch
            </button>
          )}
        </div>

        {/* Output Gallery */}
        <AnimatePresence>
          {status === 'completed' && clips.length > 0 && (
            <motion.div
              initial={{ y: 20, opacity: 0 }}
              animate={{ y: 0, opacity: 1 }}
              className="mt-12"
            >
              <div className="flex flex-col sm:flex-row items-center justify-between mb-6 gap-4">
                <h2 className="text-2xl font-bold text-gray-800">Your Video Clips</h2>
                <div className="flex gap-2 flex-wrap justify-end">
                  {/* Download specific job outputs or maybe hide this if multiple batches since the backend only zips one job output originally. For now we will hide download ALL if batch > 1 since the backend doesn't support grouping job zips out of the box. */}
                  {batchJobs.length > 0 && (
                    <a
                      href={`${API_BASE}/download-batch-zip?movieName=${encodeURIComponent(movieName.trim() || batchJobId)}`}
                      className="px-5 py-2.5 bg-indigo-600 text-white rounded-lg font-medium flex items-center gap-2 hover:bg-indigo-700 transition-colors shadow-sm"
                    >
                      <FolderArchive className="w-5 h-5" /> Download All (ZIP)
                    </a>
                  )}
                  {onEditBatchClip && clips.length > 0 && (
                    <button
                      onClick={() => onEditBatchClip(clips)}
                      className="px-5 py-2.5 bg-blue-500 text-white rounded-lg font-medium flex items-center gap-2 hover:bg-blue-600 transition-colors shadow-sm"
                    >
                      <Smartphone className="w-5 h-5" /> Edit All as Batch
                    </button>
                  )}
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-6">
                {clips.map((clip, globalIndex) => (
                  <motion.div
                    key={`${clip.name}-${globalIndex}`}
                    initial={{ scale: 0.9, opacity: 0 }}
                    animate={{ scale: 1, opacity: 1 }}
                    transition={{ delay: globalIndex * 0.05 }}
                    className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden flex flex-col group hover:shadow-md transition-shadow"
                  >
                    <div className="aspect-video bg-gray-100 relative">
                      <video
                        src={`${API_BASE_URL}${clip.url}`}
                        className="w-full h-full object-cover"
                        controls
                        preload="metadata"
                      />
                    </div>
                    <div className="p-4 flex flex-col flex-grow">
                      <h4 className="font-semibold text-gray-800 mb-1">Part {clip.index}</h4>
                      <p className="text-xs text-indigo-500 font-medium mb-1 truncate">{clip.originalJob}</p>
                      <p className="text-xs text-gray-500 mb-4 truncate">{clip.name}</p>

                      <div className="mt-auto pt-3 border-t border-gray-100 flex flex-col gap-2">
                        <a
                          href={`${API_BASE_URL}${clip.url}`}
                          download
                          target="_blank"
                          rel="noreferrer"
                          className="w-full flex items-center justify-center gap-2 bg-gray-50 hover:bg-gray-100 text-gray-700 py-2 rounded-lg font-medium text-sm transition-colors"
                        >
                          <Download className="w-4 h-4" /> Download
                        </a>
                        {onEditClip && (
                          <button
                            onClick={() => onEditClip(clip)}
                            className="w-full flex items-center justify-center gap-2 bg-indigo-50 hover:bg-indigo-100 text-indigo-600 py-2 rounded-lg font-medium text-sm transition-colors"
                          >
                            <Smartphone className="w-4 h-4" /> Edit Layout
                          </button>
                        )}
                      </div>
                    </div>
                  </motion.div>
                ))}
              </div>
            </motion.div>
          )}
        </AnimatePresence>

      </main>
    </div>
  );
}
