'use client';

import { useEffect, useState, useRef } from 'react';
import { motion } from 'framer-motion';
import { Upload, Trash2, Video, Image as ImageIcon, Film, RefreshCw, AlertCircle, Eye } from 'lucide-react';
import DashboardLayout from '../../components/layout/DashboardLayout';
import { authService } from '../../services/authService';
import { mediaService } from '../../services/mediaService';
import { cn } from '../../lib/utils';

export default function MediaLibraryPage() {
  const [user, setUser] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [media, setMedia] = useState<any[]>([]);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [uploadType, setUploadType] = useState<'video'|'image'|'thumbnail'>('video'); // purely frontend tracker for which type to upload
  const [previewType, setPreviewType] = useState<'videos' | 'images' | null>(null);
  const [previewIndex, setPreviewIndex] = useState(0);
  const [previewRunning, setPreviewRunning] = useState(false);
  const previewTimerRef = useRef<number | null>(null);
  const dragIdRef = useRef<string | null>(null);
  const durationSaveTimers = useRef<Record<string, number>>({});
  const videos = media.filter(m => m.type === 'video');
  const images = media.filter(m => m.type === 'image');
  const thumbnails = media.filter(m => m.type === 'thumbnail');

  useEffect(() => {
    fetchData();
  }, []);

  const fetchData = async () => {
    try {
      const [userData, mediaData] = await Promise.all([
        authService.getMe(),
        mediaService.getMedia()
      ]);
      setUser(userData.data);
      setMedia(mediaData.data || []);
    } catch (err) {
      console.error("Error loading media data:", err);
      // Optional: authService.logout() if needed
    } finally {
      setLoading(false);
    }
  };

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setError(null);
    setUploading(true);

    try {
      // Basic validation
      if (file.size > 50 * 1024 * 1024) {
        throw new Error("File is too large (Max 50MB)");
      }

      let duration = 0;
      if (file.type.startsWith('video/')) {
        if (uploadType === 'thumbnail') {
           throw new Error("Thumbnails must be an image.");
        }
        duration = await getVideoDuration(file);
      }

      await mediaService.uploadMedia(file, duration, uploadType === 'thumbnail' ? 'thumbnail' : undefined);
      await fetchData();
    } catch (err: any) {
      setError(err.response?.data?.message || err.message || "Failed to upload media");
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  const getVideoDuration = (file: File): Promise<number> => {
    return new Promise((resolve) => {
      const video = document.createElement('video');
      video.preload = 'metadata';
      video.onloadedmetadata = () => {
        window.URL.revokeObjectURL(video.src);
        resolve(Math.ceil(video.duration));
      };
      video.src = URL.createObjectURL(file);
    });
  };

  const handleDelete = async (id: string) => {
    if (!confirm('Are you sure you want to delete this file?')) return;
    try {
      await mediaService.deleteMedia(id);
      await fetchData();
    } catch (err: any) {
      setError(err.response?.data?.message || "Failed to delete media");
    }
  };

  const clearPreviewTimer = () => {
    if (previewTimerRef.current) {
      window.clearTimeout(previewTimerRef.current);
      previewTimerRef.current = null;
    }
  };

  const closePreview = () => {
    clearPreviewTimer();
    setPreviewRunning(false);
    setPreviewType(null);
    setPreviewIndex(0);
  };

  const startImagePreview = () => {
    setPreviewType('images');
    setPreviewIndex(0);
    setPreviewRunning(true);
  };

  const startVideoPreview = () => {
    setPreviewType('videos');
    setPreviewIndex(0);
    setPreviewRunning(true);
  };

  const scheduleNextImage = (durationSec: number) => {
    clearPreviewTimer();
    previewTimerRef.current = window.setTimeout(() => {
      setPreviewIndex(prev => prev + 1);
    }, Math.max(1, durationSec) * 1000) as unknown as number;
  };

  useEffect(() => {
    if (previewType === 'images' && previewRunning && images.length > 0) {
      const item = images[previewIndex % images.length];
      scheduleNextImage(item?.imageDuration || 3);
    }
    return () => {
      if (previewType === 'images') clearPreviewTimer();
    };
  }, [previewType, previewRunning, previewIndex, images]);

  const handleReorder = async (type: 'video' | 'image', newOrder: any[]) => {
    setMedia(prev => {
      const others = prev.filter(m => m.type !== type);
      return [...newOrder, ...others];
    });
    try {
      await mediaService.reorderMedia(type, newOrder.map(m => m._id));
    } catch (err: any) {
      setError(err.response?.data?.message || 'Failed to reorder media');
      await fetchData();
    }
  };

  const handleDurationChange = (id: string, value: number) => {
    setMedia(prev => prev.map(m => (m._id === id ? { ...m, imageDuration: value } : m)));
    const existing = durationSaveTimers.current[id];
    if (existing) window.clearTimeout(existing);
    durationSaveTimers.current[id] = window.setTimeout(async () => {
      try {
        await mediaService.updateMedia(id, { imageDuration: value });
      } catch (err: any) {
        setError(err.response?.data?.message || 'Failed to update image duration');
      }
    }, 500) as unknown as number;
  };

  if (loading) {
    return (
      <DashboardLayout user={user}>
        <div className="flex items-center space-x-3 text-slate-400 text-sm">
          <RefreshCw className="h-4 w-4 animate-spin text-[#7C5CFF]" />
          <span>Loading media library...</span>
        </div>
      </DashboardLayout>
    );
  }

  const totalVideoDuration = videos.reduce((acc, curr) => acc + (curr.duration || 0), 0);
  const maxVideoDuration = 70;
  const maxImages = 20;
  const maxThumbnails = 10;

  const mixedList = [...media].filter(m => ['video', 'image'].includes(m.type));

  const handleMixedReorder = async (newOrder: any[]) => {
    setMedia(prev => {
      const others = prev.filter(m => !['video', 'image'].includes(m.type));
      return [...newOrder, ...others];
    });
    try {
      await mediaService.reorderMixed(newOrder.map(m => m._id));
    } catch (err: any) {
      setError(err.response?.data?.message || 'Failed to reorder media');
      await fetchData();
    }
  };

  const triggerUpload = (type: 'video'|'image'|'thumbnail') => {
    setUploadType(type);
    if (fileInputRef.current) {
      if (type === 'video') fileInputRef.current.accept = "video/mp4,video/quicktime,video/webm";
      else fileInputRef.current.accept = "image/jpeg,image/png,image/webp";
      fileInputRef.current.click();
    }
  };

  return (
    <DashboardLayout user={user}>
      <div className="max-w-6xl mx-auto py-8 px-4 sm:px-6">

        <div className="flex flex-col md:flex-row justify-between items-start md:items-center mb-8 gap-4">
          <div>
            <h1 className="text-3xl font-extrabold text-transparent bg-clip-text bg-gradient-to-r from-white to-slate-400">Media Library</h1>
            <p className="text-slate-400 mt-2">Upload custom clips, images, and thumbnails to use in your pipeline generations.</p>
          </div>

          <div className="flex flex-col md:flex-row gap-4 items-center">
             <div className="flex space-x-6 text-sm">
                <div className="text-right">
                  <span className="text-slate-500 block text-xs uppercase tracking-wider font-bold">Total Video</span>
                  <span className={cn("font-mono font-bold", totalVideoDuration > maxVideoDuration * 0.8 ? "text-yellow-400" : "text-[#00D4FF]")}>
                     {totalVideoDuration}s <span className="text-slate-500 font-normal">/ {maxVideoDuration}s</span>
                  </span>
                </div>
                <div className="text-right">
                  <span className="text-slate-500 block text-xs uppercase tracking-wider font-bold">Images</span>
                  <span className={cn("font-mono font-bold", images.length > maxImages * 0.8 ? "text-yellow-400" : "text-[#FF4FD8]")}>
                     {images.length} <span className="text-slate-500 font-normal">/ {maxImages}</span>
                  </span>
                </div>
                <div className="text-right hidden sm:block">
                  <span className="text-slate-500 block text-xs uppercase tracking-wider font-bold">Thumbs</span>
                  <span className={cn("font-mono font-bold", thumbnails.length > maxThumbnails * 0.8 ? "text-yellow-400" : "text-emerald-400")}>
                     {thumbnails.length} <span className="text-slate-500 font-normal">/ {maxThumbnails}</span>
                  </span>
                </div>
             </div>

             <div className="flex bg-[#0B0F1A] rounded-xl border border-[#1A2235] p-1 overflow-hidden">
                <button
                  onClick={() => triggerUpload('video')}
                  disabled={uploading}
                  className="px-4 py-2 hover:bg-[#1A2235] rounded-lg text-sm font-bold text-white transition-colors disabled:opacity-50"
                >
                  + Video
                </button>
                <button
                  onClick={() => triggerUpload('image')}
                  disabled={uploading}
                  className="px-4 py-2 hover:bg-[#1A2235] rounded-lg text-sm font-bold text-white transition-colors disabled:opacity-50"
                >
                  + Image
                </button>
                <button
                  onClick={() => triggerUpload('thumbnail')}
                  disabled={uploading}
                  className="px-4 py-2 bg-[#7C5CFF] hover:bg-[#6b4fe0] rounded-lg text-sm font-bold text-white transition-colors shadow-glow-primary disabled:opacity-50"
                >
                  + Thumbnail
                </button>
             </div>

             <div className="flex gap-2">
               <button
                 onClick={startVideoPreview}
                 disabled={videos.length === 0}
                 className="px-3 py-2 rounded-lg text-xs font-bold border border-[#1A2235] bg-[#0B0F1A] text-slate-200 hover:text-white hover:border-[#7C5CFF]/60 transition-colors disabled:opacity-50"
               >
                 <Eye className="h-3.5 w-3.5 inline-block mr-1" /> Preview Videos
               </button>
               <button
                 onClick={startImagePreview}
                 disabled={images.length === 0}
                 className="px-3 py-2 rounded-lg text-xs font-bold border border-[#1A2235] bg-[#0B0F1A] text-slate-200 hover:text-white hover:border-[#7C5CFF]/60 transition-colors disabled:opacity-50"
               >
                 <Eye className="h-3.5 w-3.5 inline-block mr-1" /> Preview Images
               </button>
             </div>

             {/* Hidden file input */}
             <input
               type="file"
               ref={fileInputRef}
               className="hidden"
               onChange={handleFileChange}
             />
          </div>
        </div>

        {error && (
          <div className="mb-6 p-4 rounded-xl border flex items-center bg-red-500/10 border-red-500/20 text-red-400 text-sm font-medium">
            <AlertCircle className="h-5 w-5 mr-3 flex-shrink-0" />
            {error}
          </div>
        )}

        <div className="space-y-12">
           {/* Sequence Builder (Mixed) */}
           <div>
             <div className="flex items-center mb-6 border-b border-[#1A2235] pb-2">
                <Film className="h-5 w-5 text-[#7C5CFF] mr-2" />
                <h2 className="text-xl font-bold text-white tracking-tight">Sequence Builder (Videos + Images)</h2>
             </div>
             {mixedList.length === 0 ? (
               <div className="text-center py-10 bg-[#0B0F1A] border border-[#1A2235] border-dashed rounded-2xl text-slate-500">
                  <Film className="h-10 w-10 mx-auto mb-3 opacity-30" />
                  <p>No media in the sequence yet.</p>
               </div>
             ) : (
               <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-4">
                 {mixedList.map(item => (
                   <motion.div
                     key={item._id}
                     initial={{ opacity: 0 }}
                     animate={{ opacity: 1 }}
                     draggable
                     onDragStart={() => { dragIdRef.current = item._id; }}
                     onDragOver={(e) => e.preventDefault()}
                     onDrop={() => {
                       const fromId = dragIdRef.current;
                       if (!fromId || fromId === item._id) return;
                       const list = [...mixedList];
                       const fromIndex = list.findIndex(x => x._id === fromId);
                       const toIndex = list.findIndex(x => x._id === item._id);
                       if (fromIndex === -1 || toIndex === -1) return;
                       const [moved] = list.splice(fromIndex, 1);
                       list.splice(toIndex, 0, moved);
                       handleMixedReorder(list);
                     }}
                     className="group relative bg-[#111827] rounded-xl border border-[#1A2235] overflow-hidden aspect-[9/16] shadow-lg cursor-move"
                   >
                     {item.type === 'image' ? (
                       <>
                         <img
                           src={`${process.env.NEXT_PUBLIC_API_URL || 'http://localhost:5000'}/${item.path}`}
                           alt={item.originalName}
                           className="absolute inset-0 w-full h-full object-cover"
                           onError={(e) => {
                             (e.target as HTMLImageElement).style.display = 'none';
                           }}
                         />
                         <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-[#0B0F1A]/90 to-transparent p-2">
                           <div className="flex items-center justify-between gap-2">
                             <span className="text-[10px] text-white truncate">{item.originalName}</span>
                             <div className="flex items-center gap-1 text-[10px] text-slate-200">
                               <span className="text-slate-400">Dur</span>
                               <input
                                 type="number"
                                 min={1}
                                 max={15}
                                 value={item.imageDuration || 3}
                                 onChange={(e) => handleDurationChange(item._id, Number(e.target.value))}
                                 className="w-12 bg-[#0B0F1A] border border-[#1A2235] rounded px-1 py-0.5 text-[10px] text-white"
                               />
                               <span className="text-slate-400">s</span>
                             </div>
                           </div>
                         </div>
                       </>
                     ) : (
                       <div className="absolute inset-0 bg-[#0B0F1A] flex flex-col items-center justify-center p-4 text-center">
                         <Film className="h-8 w-8 text-[#00D4FF] mb-2 opacity-50" />
                         <span className="text-xs text-slate-400 break-all line-clamp-2">{item.originalName}</span>
                         <span className="text-[#00D4FF] font-mono text-xs font-bold mt-2">{item.duration}s</span>
                       </div>
                     )}
                   </motion.div>
                 ))}
               </div>
             )}
           </div>

           {/* Videos Section */}
           <div>
             <div className="flex items-center mb-6 border-b border-[#1A2235] pb-2">
                <Film className="h-5 w-5 text-[#00D4FF] mr-2" />
                <h2 className="text-xl font-bold text-white tracking-tight">Custom Videos</h2>
             </div>
             {videos.length === 0 ? (
               <div className="text-center py-10 bg-[#0B0F1A] border border-[#1A2235] border-dashed rounded-2xl text-slate-500">
                  <Video className="h-10 w-10 mx-auto mb-3 opacity-30" />
                  <p>No videos uploaded yet.</p>
               </div>
             ) : (
               <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-5 gap-4">
                 {videos.map(v => (
                   <motion.div
                     key={v._id}
                     initial={{ opacity: 0 }}
                     animate={{ opacity: 1 }}
                     draggable
                     onDragStart={() => { dragIdRef.current = v._id; }}
                     onDragOver={(e) => e.preventDefault()}
                     onDrop={() => {
                       const fromId = dragIdRef.current;
                       if (!fromId || fromId === v._id) return;
                       const list = [...videos];
                       const fromIndex = list.findIndex(x => x._id === fromId);
                       const toIndex = list.findIndex(x => x._id === v._id);
                       if (fromIndex === -1 || toIndex === -1) return;
                       const [moved] = list.splice(fromIndex, 1);
                       list.splice(toIndex, 0, moved);
                       handleReorder('video', list);
                     }}
                     className="group relative bg-[#111827] rounded-xl border border-[#1A2235] overflow-hidden aspect-[9/16] shadow-lg cursor-move"
                   >
                      {/* For simplicity we just use a generic thumbnail placeholder unless we generate real thumbnails */}
                      <div className="absolute inset-0 bg-[#0B0F1A] flex flex-col items-center justify-center p-4 text-center">
                         <Film className="h-8 w-8 text-[#00D4FF] mb-2 opacity-50" />
                         <span className="text-xs text-slate-400 break-all line-clamp-2">{v.originalName}</span>
                         <span className="text-[#00D4FF] font-mono text-xs font-bold mt-2">{v.duration}s</span>
                      </div>
                      <button onClick={() => handleDelete(v._id)} className="absolute top-2 right-2 p-2 bg-red-500/80 hover:bg-red-600 text-white rounded-lg opacity-0 group-hover:opacity-100 transition-opacity backdrop-blur-sm">
                         <Trash2 className="h-4 w-4" />
                      </button>
                   </motion.div>
                 ))}
               </div>
             )}
           </div>

           {/* Images Section */}
           <div>
             <div className="flex items-center mb-6 border-b border-[#1A2235] pb-2">
                <ImageIcon className="h-5 w-5 text-[#FF4FD8] mr-2" />
                <h2 className="text-xl font-bold text-white tracking-tight">Custom Images</h2>
             </div>
             {images.length === 0 ? (
               <div className="text-center py-10 bg-[#0B0F1A] border border-[#1A2235] border-dashed rounded-2xl text-slate-500">
                  <ImageIcon className="h-10 w-10 mx-auto mb-3 opacity-30" />
                  <p>No images uploaded yet.</p>
               </div>
             ) : (
               <div className="grid grid-cols-3 md:grid-cols-5 lg:grid-cols-6 gap-4">
                 {images.map(img => (
                   <motion.div
                     key={img._id}
                     initial={{ opacity: 0 }}
                     animate={{ opacity: 1 }}
                     draggable
                     onDragStart={() => { dragIdRef.current = img._id; }}
                     onDragOver={(e) => e.preventDefault()}
                     onDrop={() => {
                       const fromId = dragIdRef.current;
                       if (!fromId || fromId === img._id) return;
                       const list = [...images];
                       const fromIndex = list.findIndex(x => x._id === fromId);
                       const toIndex = list.findIndex(x => x._id === img._id);
                       if (fromIndex === -1 || toIndex === -1) return;
                       const [moved] = list.splice(fromIndex, 1);
                       list.splice(toIndex, 0, moved);
                       handleReorder('image', list);
                     }}
                     className="group relative bg-[#111827] rounded-xl border border-[#1A2235] overflow-hidden aspect-square shadow-lg cursor-move"
                   >
                      <img
                        src={`${process.env.NEXT_PUBLIC_API_URL || 'http://localhost:5000'}/${img.path}`}
                        alt={img.originalName}
                        className="absolute inset-0 w-full h-full object-cover"
                        onError={(e) => {
                          // Fallback if static serving fails locally
                          (e.target as HTMLImageElement).style.display = 'none';
                        }}
                      />
                      <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-[#0B0F1A]/90 to-transparent p-2 opacity-0 group-hover:opacity-100 transition-opacity">
                         <div className="flex items-center justify-between gap-2">
                           <span className="text-[10px] text-white truncate">{img.originalName}</span>
                           <div className="flex items-center gap-1 text-[10px] text-slate-200">
                             <span className="text-slate-400">Dur</span>
                             <input
                               type="number"
                               min={1}
                               max={15}
                               value={img.imageDuration || 3}
                               onChange={(e) => handleDurationChange(img._id, Number(e.target.value))}
                               className="w-12 bg-[#0B0F1A] border border-[#1A2235] rounded px-1 py-0.5 text-[10px] text-white"
                             />
                             <span className="text-slate-400">s</span>
                           </div>
                         </div>
                      </div>
                      <button onClick={() => handleDelete(img._id)} className="absolute top-2 right-2 p-1.5 bg-red-500/80 hover:bg-red-600 text-white rounded-lg opacity-0 group-hover:opacity-100 transition-opacity backdrop-blur-sm">
                         <Trash2 className="h-3.5 w-3.5" />
                      </button>
                   </motion.div>
                 ))}
               </div>
             )}
           </div>

           {/* Thumbnails Section */}
           <div>
             <div className="flex items-center mb-6 border-b border-[#1A2235] pb-2">
                <ImageIcon className="h-5 w-5 text-emerald-400 mr-2" />
                <h2 className="text-xl font-bold text-white tracking-tight">Custom Thumbnails</h2>
             </div>
             {thumbnails.length === 0 ? (
               <div className="text-center py-10 bg-[#0B0F1A] border border-[#1A2235] border-dashed rounded-2xl text-slate-500">
                  <ImageIcon className="h-10 w-10 mx-auto mb-3 opacity-30" />
                  <p>No thumbnails uploaded yet.</p>
               </div>
             ) : (
               <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-5 gap-4">
                 {thumbnails.map(img => (
                   <motion.div key={img._id} initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="group relative bg-[#111827] rounded-xl border border-[#1A2235] overflow-hidden aspect-video shadow-lg">
                      <img
                        src={`${process.env.NEXT_PUBLIC_API_URL || 'http://localhost:5000'}/${img.path}`}
                        alt={img.originalName}
                        className="absolute inset-0 w-full h-full object-cover"
                        onError={(e) => {
                          (e.target as HTMLImageElement).style.display = 'none';
                        }}
                      />
                      <div className="absolute inset-0 bg-gradient-to-t from-[#0B0F1A]/80 to-transparent flex items-end p-2 opacity-0 group-hover:opacity-100 transition-opacity">
                         <span className="text-[10px] text-white truncate w-full">{img.originalName}</span>
                      </div>
                      <button onClick={() => handleDelete(img._id)} className="absolute top-2 right-2 p-1.5 bg-red-500/80 hover:bg-red-600 text-white rounded-lg opacity-0 group-hover:opacity-100 transition-opacity backdrop-blur-sm">
                         <Trash2 className="h-3.5 w-3.5" />
                      </button>
                   </motion.div>
                 ))}
               </div>
             )}
           </div>

        </div>

        {previewType && (
          <div
            className="fixed inset-0 z-[999] bg-black/70 backdrop-blur-sm flex items-center justify-center p-4"
            onClick={closePreview}
          >
            <div
              className="bg-[#0B0F1A] border border-[#1A2235] rounded-2xl shadow-2xl w-full max-w-sm overflow-hidden"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="flex items-center justify-between p-3 border-b border-[#1A2235]">
                <h3 className="text-xs font-bold text-white">
                  {previewType === 'images' ? 'Images Preview (9:16)' : 'Videos Preview (9:16)'}
                </h3>
                <button onClick={closePreview} className="text-xs text-slate-300 hover:text-white">Close</button>
              </div>
              <div className="p-3">
                <div className="w-full aspect-[9/16] bg-black rounded-xl overflow-hidden border border-[#1A2235] flex items-center justify-center">
                  {previewType === 'images' && images.length > 0 && (
                    (() => {
                      const item = images[previewIndex % images.length];
                      return (
                        <img
                          src={`${process.env.NEXT_PUBLIC_API_URL || 'http://localhost:5000'}/${item.path}`}
                          alt={item.originalName}
                          className="w-full h-full object-cover"
                        />
                      );
                    })()
                  )}
                  {previewType === 'videos' && videos.length > 0 && (
                    <video
                      key={videos[previewIndex % videos.length]?._id}
                      src={`${process.env.NEXT_PUBLIC_API_URL || 'http://localhost:5000'}/${videos[previewIndex % videos.length]?.path}`}
                      className="w-full h-full object-cover"
                      controls
                      autoPlay
                      onEnded={() => setPreviewIndex(prev => prev + 1)}
                    />
                  )}
                </div>
                <div className="mt-2 flex items-center justify-between text-[10px] text-slate-400">
                  <span>{previewType === 'images' ? 'Auto-play based on image duration.' : 'Auto-advance when clip ends.'}</span>
                  <span>{previewIndex + 1} / {(previewType === 'images' ? images.length : videos.length) || 0}</span>
                </div>
              </div>
            </div>
          </div>
        )}

      </div>
    </DashboardLayout>
  );
}
