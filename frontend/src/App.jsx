import React, { useState } from 'react';
import { Scissors, Smartphone } from 'lucide-react';
import VideoSplitter from './components/VideoSplitter';
import VerticalEditor from './components/VerticalEditor';

const API_BASE_URL = import.meta.env.VITE_API_URL || 'http://localhost:5000';

export default function App() {
  const [activeTab, setActiveTab] = useState('splitter'); // 'splitter' or 'vertical'
  const [clipToEdit, setClipToEdit] = useState(null);
  const [batchClips, setBatchClips] = useState(null);

  const handleEditClip = (clip) => {
    // Pass the backend reference directly instead of downloading it over the network
    setClipToEdit({
      sourceUrl: clip.url,
      name: clip.name,
      url: `${API_BASE_URL}${clip.url}`
    });
    setBatchClips(null);
    setActiveTab('vertical');
  };

  const handleEditClipsBatch = (clips) => {
    const formattedClips = clips.map(clip => ({
      sourceUrl: clip.url,
      name: clip.name,
      url: `${API_BASE_URL}${clip.url}`
    }));
    setClipToEdit(formattedClips[0]);
    setBatchClips(formattedClips);
    setActiveTab('vertical');
  };

  return (
    <div className="min-h-screen font-sans bg-gray-50 text-gray-900">
      <header className="bg-white shadow-sm sticky top-0 z-50">
        <div className="max-w-6xl mx-auto px-4 py-4 flex flex-col sm:flex-row items-center justify-between gap-4">
          <div className="flex items-center space-x-2 text-indigo-600">
            <Scissors className="w-8 h-8" />
            <h1 className="text-2xl font-bold tracking-tight">VideoCutter</h1>
          </div>

          <div className="flex bg-gray-100 p-1 rounded-lg">
            <button
              onClick={() => setActiveTab('splitter')}
              className={`px-4 py-2 rounded-md font-medium text-sm transition-colors ${activeTab === 'splitter' ? 'bg-white shadow text-indigo-600' : 'text-gray-600 hover:text-gray-900'
                }`}
            >
              <div className="flex items-center gap-2">
                <Scissors className="w-4 h-4" />
                Video Splitter
              </div>
            </button>
            <button
              onClick={() => setActiveTab('vertical')}
              className={`px-4 py-2 rounded-md font-medium text-sm transition-colors ${activeTab === 'vertical' ? 'bg-white shadow text-indigo-600' : 'text-gray-600 hover:text-gray-900'
                }`}
            >
              <div className="flex items-center gap-2">
                <Smartphone className="w-4 h-4" />
                Vertical Editor
              </div>
            </button>
          </div>
        </div>
      </header>

      <div style={{ display: activeTab === 'splitter' ? 'block' : 'none' }}>
        <VideoSplitter onEditClip={handleEditClip} onEditBatchClip={handleEditClipsBatch} />
      </div>
      <div style={{ display: activeTab === 'vertical' ? 'block' : 'none' }}>
        <VerticalEditor initialVideo={clipToEdit} batchClips={batchClips} />
      </div>
    </div>
  );
}
