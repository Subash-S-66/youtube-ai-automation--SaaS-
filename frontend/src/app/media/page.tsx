'use client';

import { useEffect, useState, useRef } from 'react';
import { motion } from 'framer-motion';
import { Upload, Trash2, Video, Image as ImageIcon, Film, RefreshCw, AlertCircle } from 'lucide-react';
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

  const videos = media.filter(m => m.type === 'video');
  const images = media.filter(m => m.type === 'image');
  const thumbnails = media.filter(m => m.type === 'thumbnail');

  const totalVideoDuration = videos.reduce((acc, curr) => acc + (curr.duration || 0), 0);
  const maxVideoDuration = 70;
  const maxImages = 20;
  const maxThumbnails = 10;

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
                   <motion.div key={v._id} initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="group relative bg-[#111827] rounded-xl border border-[#1A2235] overflow-hidden aspect-[9/16] shadow-lg">
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
                   <motion.div key={img._id} initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="group relative bg-[#111827] rounded-xl border border-[#1A2235] overflow-hidden aspect-square shadow-lg">
                      <img
                        src={`${process.env.NEXT_PUBLIC_API_URL || 'http://localhost:5000'}/${img.path}`}
                        alt={img.originalName}
                        className="absolute inset-0 w-full h-full object-cover"
                        onError={(e) => {
                          // Fallback if static serving fails locally
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

      </div>
    </DashboardLayout>
  );
}