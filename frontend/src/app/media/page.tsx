'use client';
import NextImage from 'next/image';
import Link from 'next/link';
import { useEffect, useState, useRef, useCallback, useMemo } from 'react';
import { m } from 'framer-motion';
import { Upload, Trash2, Video, Image as ImageIcon, Film, RefreshCw, AlertCircle, Eye } from 'lucide-react';
import DashboardLayout from '../../components/layout/DashboardLayout';
import { authService } from '../../services/authService';
import { mediaService } from '../../services/mediaService';
import { cn } from '../../lib/utils';
import { getMediaUrl } from '../../lib/mediaUrl';

interface MediaPolicy {
  plan: string;
  maxMediaItems: number;
  maxVideoItems: number;
  maxImageItems: number;
  maxThumbnailItems: number;
  maxClipLengthSeconds: number;
  maxTotalVideoDurationSeconds: number;
}

type MediaKind = 'video' | 'image' | 'thumbnail';

interface MediaItem {
  _id: string;
  type: MediaKind;
  path: string;
  originalName: string;
  duration?: number;
  imageDuration?: number;
  trimStart?: number;
  trimEnd?: number;
}

interface SequenceItem {
  _id: string;
  media?: MediaItem | null;
}

interface MediaUser {
  planFeatures?: {
    custom_media?: boolean;
  };
  [key: string]: unknown;
}

interface AuthMeResponse {
  data?: MediaUser;
}

interface MediaResponse {
  data?: MediaItem[];
  policy?: MediaPolicy | null;
}

interface SequenceResponse {
  data?: SequenceItem[];
}

interface UploadMediaResponse {
  data?: {
    _id?: string;
  };
}

interface AddToSequenceResponse {
  data?: SequenceItem;
}

interface ApiErrorShape {
  response?: {
    data?: {
      message?: string;
    };
  };
  message?: string;
}

const getApiErrorMessage = (error: unknown, fallback: string): string => {
  if (typeof error === 'object' && error !== null) {
    const err = error as ApiErrorShape;
    const responseMessage = err.response?.data?.message;
    if (typeof responseMessage === 'string' && responseMessage.trim().length > 0) {
      return responseMessage;
    }
    if (typeof err.message === 'string' && err.message.trim().length > 0) {
      return err.message;
    }
  }
  return fallback;
};

export default function MediaLibraryPage() {
  const [user, setUser] = useState<MediaUser | null>(null);
  const [loading, setLoading] = useState(true);
  const [media, setMedia] = useState<MediaItem[]>([]);
  const [sequenceItems, setSequenceItems] = useState<SequenceItem[]>([]);
  const [mediaPolicy, setMediaPolicy] = useState<MediaPolicy | null>(null);
  const [error, setError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const autoAddToSequenceRef = useRef<boolean>(false);
  const [uploadType, setUploadType] = useState<'video'|'image'|'thumbnail'>('video'); // purely frontend tracker for which type to upload
  const [previewType, setPreviewType] = useState<'videos' | 'images' | 'sequence' | null>(null);
  const [previewIndex, setPreviewIndex] = useState(0);
  const [previewRunning, setPreviewRunning] = useState(false);
  const [loopPreview, setLoopPreview] = useState(true);
  const previewTimerRef = useRef<number | null>(null);
  const dragIdRef = useRef<string | null>(null);
  const [dragOverId, setDragOverId] = useState<string | null>(null);
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [sequenceDropActive, setSequenceDropActive] = useState(false);
  const sequenceDropRef = useRef<HTMLDivElement | null>(null);
  const ghostRef = useRef<HTMLDivElement | null>(null);
  const [pointerDragId, setPointerDragId] = useState<string | null>(null);
  const pointerPosRef = useRef<{ x: number; y: number } | null>(null);
  const pointerRafRef = useRef<number | null>(null);
  const sequenceActiveRef = useRef(false);
  const [touchDragId, setTouchDragId] = useState<string | null>(null);
  const touchTimerRef = useRef<number | null>(null);
  const isTouchDeviceRef = useRef(false);
  const dragPosRef = useRef<{ y: number } | null>(null);
  const autoScrollRafRef = useRef<number | null>(null);
  const durationSaveTimers = useRef<Record<string, number>>({});
  const videos = media.filter((m) => m.type === 'video');
  const images = media.filter((m) => m.type === 'image');
  const thumbnails = media.filter((m) => m.type === 'thumbnail');

  const fetchData = useCallback(async () => {
    try {
      const userData = await authService.getMe() as AuthMeResponse;
      const currentUser = userData?.data ?? null;
      setUser(currentUser);

      const canUseCustomMedia = Boolean(currentUser?.planFeatures?.custom_media);
      if (!canUseCustomMedia) {
        setMedia([]);
        setSequenceItems([]);
        setMediaPolicy(null);
        return;
      }

      const [mediaData, sequenceData] = await Promise.all([
        mediaService.getMedia(),
        mediaService.getSequence(),
      ]) as [MediaResponse, SequenceResponse];

      setMedia(mediaData.data || []);
      setMediaPolicy(mediaData.policy || null);
      setSequenceItems(sequenceData.data || []);
    } catch (error) {
      console.error('Error loading media data:', error);
      // Optional: authService.logout() if needed
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void fetchData();
  }, [fetchData]);

  const handleFileChange = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setError(null);

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

      const created = await mediaService.uploadMedia(file, duration, uploadType === 'thumbnail' ? 'thumbnail' : undefined) as UploadMediaResponse;
      const newMediaId = created?.data?._id;
      if (autoAddToSequenceRef.current && newMediaId && uploadType !== 'thumbnail') {
        await mediaService.addToSequence(newMediaId);
      }
      await fetchData();
    } catch (error: unknown) {
      setError(getApiErrorMessage(error, 'Failed to upload media'));
    } finally {
      autoAddToSequenceRef.current = false;
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  }, [uploadType, fetchData]);

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

  const handleDelete = useCallback(async (id: string) => {
    if (!confirm('Are you sure you want to delete this file?')) return;
    try {
      await mediaService.deleteMedia(id);
      await fetchData();
    } catch (error: unknown) {
      setError(getApiErrorMessage(error, 'Failed to delete media'));
    }
  }, [fetchData]);

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

  const startSequencePreview = () => {
    setPreviewType('sequence');
    setPreviewIndex(0);
    setPreviewRunning(true);
  };

  const getPreviewLength = useCallback(() => {
    if (previewType === 'images') return images.length;
    if (previewType === 'videos') return videos.length;
    if (previewType === 'sequence') return sequenceItems.filter(item => item?.media).length;
    return 0;
  }, [previewType, images.length, videos.length]); // eslint-disable-line react-hooks/exhaustive-deps

  const advancePreview = useCallback(() => {
    const total = getPreviewLength();
    if (total <= 0) return;
    const next = previewIndex + 1;
    if (next >= total) {
      if (loopPreview) setPreviewIndex(0);
      else closePreview();
    } else {
      setPreviewIndex(next);
    }
  }, [previewIndex, loopPreview, getPreviewLength]); // eslint-disable-line react-hooks/exhaustive-deps

  const scheduleNextImage = useCallback((durationSec: number) => {
    clearPreviewTimer();
    previewTimerRef.current = window.setTimeout(() => {
      advancePreview();
    }, Math.max(1, durationSec) * 1000) as unknown as number;
  }, [advancePreview]);

  const sequenceList = useMemo(
    () => sequenceItems.filter((item) => item?.media),
    [sequenceItems]
  );
  const mixedList = sequenceList;

  useEffect(() => {
    if (!previewRunning) return;
    if (previewType === 'images' && images.length > 0) {
      const item = images[previewIndex % images.length];
      scheduleNextImage(item?.imageDuration || 3);
    }
    if (previewType === 'sequence' && sequenceList.length > 0) {
      const seq = sequenceList[previewIndex % sequenceList.length];
      const mediaItem = seq?.media;
      if (mediaItem?.type === 'image') {
        scheduleNextImage(mediaItem?.imageDuration || 3);
      }
    }
    return () => {
      if (previewType === 'images' || previewType === 'sequence') clearPreviewTimer();
    };
  }, [previewType, previewRunning, previewIndex, images, sequenceList, scheduleNextImage]);

  const handleDurationChange = useCallback((id: string, value: number) => {
    setMedia((prev) => prev.map((m) => (m._id === id ? { ...m, imageDuration: value } : m)));
    const existing = durationSaveTimers.current[id];
    if (existing) window.clearTimeout(existing);
    durationSaveTimers.current[id] = window.setTimeout(async () => {
      try {
        await mediaService.updateMedia(id, { imageDuration: value });
      } catch (error: unknown) {
        setError(getApiErrorMessage(error, 'Failed to update image duration'));
      }
    }, 500) as unknown as number;
  }, []);

  const handleVideoTrimChange = useCallback((id: string, field: 'trimStart' | 'trimEnd', value: number) => {
    setMedia((prev) => prev.map((m) => (m._id === id ? { ...m, [field]: value } : m)));
    const existing = durationSaveTimers.current[id];
    if (existing) window.clearTimeout(existing);
    durationSaveTimers.current[id] = window.setTimeout(async () => {
      try {
        await mediaService.updateMedia(id, { [field]: value });
      } catch (error: unknown) {
        setError(getApiErrorMessage(error, `Failed to update video ${field}`));
      }
    }, 500) as unknown as number;
  }, []);

  const totalVideoDuration = videos.reduce((acc, curr) => acc + (curr.duration || 0), 0);
  const maxVideoDuration = mediaPolicy?.maxTotalVideoDurationSeconds ?? 70;
  const maxImages = mediaPolicy?.maxImageItems ?? 20;
  const maxThumbnails = mediaPolicy?.maxThumbnailItems ?? 10;
  const maxVideos = mediaPolicy?.maxVideoItems ?? 10;
  const maxMediaItems = mediaPolicy?.maxMediaItems ?? 0;


  const handleMixedReorder = useCallback(async (newOrder: SequenceItem[]) => {
    try {
      setSequenceItems(newOrder);
      await mediaService.reorderSequence(newOrder.map((m) => m._id));
    } catch (error: unknown) {
      setError(getApiErrorMessage(error, 'Failed to reorder media'));
      await fetchData();
    }
  }, [fetchData]);

  const triggerUpload = useCallback((type: 'video'|'image'|'thumbnail', addToSequenceOnUpload = false) => {
    setUploadType(type);
    autoAddToSequenceRef.current = addToSequenceOnUpload;
    if (fileInputRef.current) {
      if (type === 'video') fileInputRef.current.accept = "video/mp4,video/quicktime,video/webm";
      else fileInputRef.current.accept = "image/jpeg,image/png,image/webp";
      fileInputRef.current.click();
    }
  }, []);

  const addToSequence = useCallback(async (mediaId: string) => {
    try {
      const result = await mediaService.addToSequence(mediaId) as AddToSequenceResponse;
      if (result?.data) {
        setSequenceItems((prev) => [...prev, result.data as SequenceItem]);
      } else {
        await fetchData();
      }
    } catch (error: unknown) {
      setError(getApiErrorMessage(error, 'Failed to add to sequence'));
    }
  }, [fetchData]);

  const handleSequenceDrop = useCallback(async (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    const mediaId = e.dataTransfer.getData('text/media-id');
    if (!mediaId) return;
    await addToSequence(mediaId);
    setSequenceDropActive(false);
  }, [addToSequence]);

  const startTouchDrag = (id: string) => {
    if (touchTimerRef.current) window.clearTimeout(touchTimerRef.current);
    touchTimerRef.current = window.setTimeout(() => {
      setTouchDragId(id);
    }, 320) as unknown as number;
  };

  const cancelTouchDrag = () => {
    if (touchTimerRef.current) window.clearTimeout(touchTimerRef.current);
    touchTimerRef.current = null;
    setTouchDragId(null);
  };

  useEffect(() => {
    if (!pointerDragId) return;

    const tick = () => {
      const pos = pointerPosRef.current;
      if (pos && ghostRef.current) {
        ghostRef.current.style.transform = `translate(${pos.x}px, ${pos.y}px) translate(-50%, -50%)`;
      }
      const zone = sequenceDropRef.current;
      if (zone && pos) {
        const rect = zone.getBoundingClientRect();
        const inside = pos.x >= rect.left && pos.x <= rect.right && pos.y >= rect.top && pos.y <= rect.bottom;
        if (sequenceActiveRef.current !== inside) {
          sequenceActiveRef.current = inside;
          setSequenceDropActive(inside);
        }
      }
      pointerRafRef.current = window.requestAnimationFrame(tick);
    };

    const onMove = (e: PointerEvent) => {
      pointerPosRef.current = { x: e.clientX, y: e.clientY };
    };

    const onUp = async (e: PointerEvent) => {
      const zone = sequenceDropRef.current;
      const id = pointerDragId;
      setPointerDragId(null);
      setSequenceDropActive(false);
      sequenceActiveRef.current = false;
      document.body.style.userSelect = '';
      if (zone && id) {
        const rect = zone.getBoundingClientRect();
        const inside = e.clientX >= rect.left && e.clientX <= rect.right && e.clientY >= rect.top && e.clientY <= rect.bottom;
        if (inside) {
          await addToSequence(id);
        }
      }
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onUp);
      if (pointerRafRef.current) {
        window.cancelAnimationFrame(pointerRafRef.current);
        pointerRafRef.current = null;
      }
    };

    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onUp);
    document.body.style.userSelect = 'none';
    pointerRafRef.current = window.requestAnimationFrame(tick);

    return () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onUp);
      if (pointerRafRef.current) {
        window.cancelAnimationFrame(pointerRafRef.current);
        pointerRafRef.current = null;
      }
      document.body.style.userSelect = '';
    };
  }, [pointerDragId, addToSequence]);

  useEffect(() => {
    if (!draggingId) return;

    const onDragOver = (e: DragEvent) => {
      dragPosRef.current = { y: e.clientY };
      e.preventDefault();
    };

    const onDragEnd = () => {
      dragPosRef.current = null;
    };

    const onWheel = (e: WheelEvent) => {
      if (!draggingId) return;
      window.scrollBy(0, e.deltaY);
      e.preventDefault();
    };
    const onMouseWheel = (e: Event) => {
      if (!draggingId) return;
      const wheelEvent = e as Event & { wheelDelta?: number; detail?: number };
      const delta = wheelEvent.wheelDelta ? -wheelEvent.wheelDelta : wheelEvent.detail ? wheelEvent.detail * 40 : 0;
      window.scrollBy(0, delta);
      e.preventDefault();
    };

    document.addEventListener('dragover', onDragOver, { passive: false });
    document.addEventListener('drop', onDragEnd);
    document.addEventListener('dragend', onDragEnd);
    document.addEventListener('wheel', onWheel, { passive: false, capture: true });
    document.addEventListener('mousewheel', onMouseWheel, { passive: false, capture: true });
    document.addEventListener('DOMMouseScroll', onMouseWheel, { passive: false, capture: true });

    const loop = () => {
      const pos = dragPosRef.current;
      if (pos) {
        const margin = 160;
        const maxSpeed = 38;
        const vh = window.innerHeight;
        if (pos.y < margin) {
          const ratio = (margin - pos.y) / margin;
          window.scrollBy(0, -Math.ceil(maxSpeed * ratio));
        } else if (pos.y > vh - margin) {
          const ratio = (pos.y - (vh - margin)) / margin;
          window.scrollBy(0, Math.ceil(maxSpeed * ratio));
        }
      }
      autoScrollRafRef.current = window.requestAnimationFrame(loop);
    };
    autoScrollRafRef.current = window.requestAnimationFrame(loop);

    return () => {
      document.removeEventListener('dragover', onDragOver as EventListener);
      document.removeEventListener('drop', onDragEnd as EventListener);
      document.removeEventListener('dragend', onDragEnd as EventListener);
      document.removeEventListener('wheel', onWheel as EventListener, true);
      document.removeEventListener('mousewheel', onMouseWheel as EventListener, true);
      document.removeEventListener('DOMMouseScroll', onMouseWheel as EventListener, true);
      if (autoScrollRafRef.current) {
        window.cancelAnimationFrame(autoScrollRafRef.current);
        autoScrollRafRef.current = null;
      }
    };
  }, [draggingId]);

  const removeSequenceItem = async (seqId: string) => {
    try {
      await mediaService.deleteSequenceItem(seqId);
      setSequenceItems((prev) => prev.filter((s) => s._id !== seqId));
    } catch (error: unknown) {
      setError(getApiErrorMessage(error, 'Failed to remove from sequence'));
    }
  };

  const mediaById = new Map(media.map((m) => [m._id, m]));

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

  if (user && !user?.planFeatures?.custom_media) {
    return (
      <DashboardLayout user={user}>
        <div className="max-w-2xl mx-auto py-10">
          <div className="rounded-2xl border border-[#1A2235] bg-[#111827] p-6">
            <div className="flex items-start gap-3">
              <AlertCircle className="h-5 w-5 text-amber-400 mt-0.5" />
              <div>
                <h2 className="text-xl font-bold text-white">Custom Media Is Not Enabled</h2>
                <p className="text-sm text-slate-400 mt-2">Your current plan does not include the custom media library. Upgrade your plan to upload videos, images, and thumbnails.</p>
                <Link
                  href="/pricing"
                  className="inline-flex mt-4 px-4 py-2 rounded-lg bg-[#7C5CFF] hover:bg-[#6b4fe0] text-white text-sm font-semibold"
                >
                  View Plans
                </Link>
              </div>
            </div>
          </div>
        </div>
      </DashboardLayout>
    );
  }

  return (
    <DashboardLayout user={user}>
      <div className="max-w-6xl w-full mx-auto py-8 px-4 sm:px-6 overflow-x-hidden">

        <div className="flex flex-col md:flex-row justify-between items-start md:items-center mb-8 gap-4">
          <div>
            <h1 className="text-3xl font-extrabold text-transparent bg-clip-text bg-gradient-to-r from-white to-slate-400">Media Library</h1>
            <p className="text-slate-400 mt-2">Upload custom clips, images, and thumbnails to use in your pipeline generations.</p>
          </div>

          <div className="flex flex-wrap gap-6 text-sm">
            <div className="text-right">
              <span className="text-slate-500 block text-xs uppercase tracking-wider font-bold">Media Items</span>
              <span className={cn("font-mono font-bold", maxMediaItems > 0 && media.length > maxMediaItems * 0.8 ? "text-yellow-400" : "text-slate-200")}>
                 {media.length} <span className="text-slate-500 font-normal">/ {maxMediaItems || 'N/A'}</span>
              </span>
            </div>
            <div className="text-right">
              <span className="text-slate-500 block text-xs uppercase tracking-wider font-bold">Video Clips</span>
              <span className={cn("font-mono font-bold", videos.length > maxVideos * 0.8 ? "text-yellow-400" : "text-[#00D4FF]")}>
                 {videos.length} <span className="text-slate-500 font-normal">/ {maxVideos}</span>
              </span>
            </div>
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

          {/* Hidden file input */}
          <input
            id="media-file-upload"
            aria-label="Upload Media File"
            type="file"
            ref={fileInputRef}
            className="hidden"
            onChange={handleFileChange}
          />
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
             <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3 mb-6 border-b border-[#1A2235] pb-2">
                <div className="flex items-center">
                  <Film className="h-5 w-5 text-[#7C5CFF] mr-2" />
                  <h2 className="text-xl font-bold text-white tracking-tight">Sequence Builder (Videos + Images)</h2>
                </div>
                <div className="flex gap-2 md:justify-end">
                  <button
                    onClick={startSequencePreview}
                    disabled={sequenceItems.filter(item => item?.media).length === 0}
                    className="px-3 py-1.5 bg-[#1A2235] hover:bg-slate-700 rounded-lg text-xs font-bold text-white transition-colors flex items-center disabled:opacity-50 border border-[#1A2235] whitespace-nowrap"
                  >
                    <Eye className="h-3.5 w-3.5 mr-1.5 shrink-0" /> Preview Sequence
                  </button>
                  <button
                    onClick={startVideoPreview}
                    disabled={videos.length === 0}
                    className="px-3 py-1.5 bg-[#1A2235] hover:bg-slate-700 rounded-lg text-xs font-bold text-white transition-colors flex items-center disabled:opacity-50 border border-[#1A2235] whitespace-nowrap"
                  >
                    <Eye className="h-3.5 w-3.5 mr-1.5 shrink-0" /> Preview Videos
                  </button>
                  <button
                    onClick={startImagePreview}
                    disabled={images.length === 0}
                    className="px-3 py-1.5 bg-[#1A2235] hover:bg-slate-700 rounded-lg text-xs font-bold text-white transition-colors flex items-center disabled:opacity-50 border border-[#1A2235] whitespace-nowrap"
                  >
                    <Eye className="h-3.5 w-3.5 mr-1.5 shrink-0" /> Preview Images
                  </button>
                </div>
             </div>
             <div
               ref={sequenceDropRef}
               onDragOver={(e) => { e.preventDefault(); setSequenceDropActive(true); }}
               onDragLeave={() => setSequenceDropActive(false)}
               onDrop={(e) => {
                 // If dragging an existing sequence item, drop to end
                 if (dragIdRef.current) {
                   const fromId = dragIdRef.current;
                   const list = [...mixedList];
                   const fromIndex = list.findIndex(x => x._id === fromId);
                   if (fromIndex !== -1) {
                     const [moved] = list.splice(fromIndex, 1);
                     list.push(moved);
                     setDraggingId(null);
                     setDragOverId(null);
                     handleMixedReorder(list);
                     return;
                   }
                 }
                 // Otherwise, handle adding media to sequence (HTML5 drag from grid)
                 handleSequenceDrop(e);
               }}
               className={cn(
                 "rounded-2xl transition-colors",
                 sequenceDropActive && "ring-2 ring-[#7C5CFF] ring-offset-2 ring-offset-[#0B0F1A]"
               )}
             >
             {mixedList.length === 0 ? (
               <div className="text-center py-10 bg-[#0B0F1A] border border-[#1A2235] border-dashed rounded-2xl text-slate-500">
                  <Film className="h-10 w-10 mx-auto mb-3 opacity-30" />
                  <p className="mb-4">No media in the sequence yet.</p>
                  <div className="flex items-center justify-center gap-3">
                    <button
                      onClick={() => triggerUpload('video', true)}
                      className="px-4 py-2 rounded-lg text-sm font-bold text-white bg-[#00D4FF]/20 hover:bg-[#00D4FF]/30 border border-[#00D4FF]/40"
                    >
                      Add Video
                    </button>
                    <button
                      onClick={() => triggerUpload('image', true)}
                      className="px-4 py-2 rounded-lg text-sm font-bold text-white bg-[#FF4FD8]/20 hover:bg-[#FF4FD8]/30 border border-[#FF4FD8]/40"
                    >
                      Add Image
                    </button>
                  </div>
               </div>
             ) : (
               <div className="grid grid-cols-3 md:grid-cols-6 lg:grid-cols-8 gap-3">
                 {mixedList.map(item => {
                   const mediaItem = item.media;
                   if (!mediaItem) return null;
                   return (
                   <m.div
                     key={item._id}
                     initial={{ opacity: 0 }}
                     animate={{ opacity: 1 }}
                     draggable={!isTouchDeviceRef.current || touchDragId === item._id}
                     onPointerDown={(e) => {
                       if (e.pointerType === 'touch') {
                         isTouchDeviceRef.current = true;
                         startTouchDrag(item._id);
                       }
                     }}
                     onPointerUp={cancelTouchDrag}
                     onPointerCancel={cancelTouchDrag}
                     onPointerLeave={cancelTouchDrag}
                     onDragStartCapture={(e: React.DragEvent<HTMLDivElement>) => {
                       if (isTouchDeviceRef.current && touchDragId !== item._id) {
                         e.preventDefault();
                         return;
                       }
                       dragIdRef.current = item._id;
                       setDraggingId(item._id);
                       e.dataTransfer.setData('text/plain', item._id);
                       e.dataTransfer.effectAllowed = 'move';
                     }}
                     onDragOver={(e) => { e.preventDefault(); setDragOverId(item._id); }}
                     onDragLeave={() => { if (dragOverId === item._id) setDragOverId(null); }}
                     onDragEnd={() => { setDraggingId(null); setDragOverId(null); cancelTouchDrag(); }}
                     onDrop={() => {
                       const fromId = dragIdRef.current;
                       if (!fromId || fromId === item._id) return;
                       const list = [...mixedList];
                       const fromIndex = list.findIndex(x => x._id === fromId);
                       const toIndex = list.findIndex(x => x._id === item._id);
                       if (fromIndex === -1 || toIndex === -1) return;
                       const [moved] = list.splice(fromIndex, 1);
                       list.splice(toIndex, 0, moved);
                       setDraggingId(null);
                       setDragOverId(null);
                       handleMixedReorder(list);
                     }}
                     className={cn(
                       "group relative bg-[#111827] rounded-xl border border-[#1A2235] overflow-hidden aspect-[9/16] shadow-lg cursor-move transition-all duration-150 ease-out hover:-translate-y-0.5 hover:shadow-xl text-[10px]",
                       draggingId === item._id && "opacity-60 scale-[0.98] rotate-[0.3deg] shadow-2xl cursor-grabbing",
                       dragOverId === item._id && "ring-2 ring-[#7C5CFF] ring-offset-2 ring-offset-[#0B0F1A] scale-[1.04]"
                     )}
                   >
                     {mediaItem.type === 'image' ? (
                       <>
                         <img
                           src={getMediaUrl(mediaItem.path)}
                           alt={mediaItem.originalName}
                           className="absolute inset-0 w-full h-full object-cover opacity-80 pointer-events-none"
                           draggable={false}
                           loading="lazy"
                           decoding="async"
                           onError={(e) => {
                             (e.target as HTMLImageElement).style.display = 'none';
                           }}
                         />
                         <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-[#0B0F1A]/90 to-transparent p-2">
                           <div className="flex flex-col gap-1">
                             <span className="text-[10px] text-white truncate drop-shadow-md">{mediaItem.originalName}</span>
                             <div className="flex items-center justify-between text-[10px] text-slate-200">
                               <span className="text-slate-400">Duration (s)</span>
                               <input
                                 id="max-videos-per-day"
                                 aria-label="Max videos per day"
                                 type="number"
                                 min={1}
                                 max={15}
                                 value={mediaItem.imageDuration || 3}
                                 onChange={(e) => handleDurationChange(mediaItem._id, Number(e.target.value))}
                                 className="w-12 bg-[#0B0F1A] border border-[#1A2235] rounded px-1 py-0.5 text-[10px] text-white"
                               />
                             </div>
                           </div>
                         </div>
                         <div className="absolute top-2 left-2 px-1.5 py-0.5 bg-black/60 rounded text-[#FF4FD8] font-mono text-[10px] font-bold backdrop-blur-sm">
                           Image
                         </div>
                       </>
                     ) : (
                       <>
                         <video
                           src={getMediaUrl(mediaItem.path)}
                           className="absolute inset-0 w-full h-full object-cover opacity-50 pointer-events-none"
                           preload="metadata"
                           muted
                           draggable={false}
                         />
                         <div className="absolute inset-0 bg-gradient-to-t from-[#0B0F1A] via-transparent to-transparent flex flex-col justify-end p-2 opacity-0 group-hover:opacity-100 transition-opacity">
                            <span className="text-[10px] text-white truncate w-full drop-shadow-md">{mediaItem.originalName}</span>
                            <div className="flex flex-col gap-1 mt-1">
                              <div className="flex items-center justify-between text-[10px] text-slate-300">
                                <span>Start (s)</span>
                                <input
                                  type="number"
                                  min={0}
                                  max={mediaItem.duration}
                                  step={0.1}
                                  value={mediaItem.trimStart || 0}
                                  onChange={(e) => handleVideoTrimChange(mediaItem._id, 'trimStart', Number(e.target.value))}
                                  className="w-12 bg-[#0B0F1A] border border-[#1A2235] rounded px-1 py-0.5 text-white"
                                />
                              </div>
                              <div className="flex items-center justify-between text-[10px] text-slate-300">
                                <span>End (s)</span>
                                <input
                                  type="number"
                                  min={0}
                                  max={mediaItem.duration}
                                  step={0.1}
                                  value={mediaItem.trimEnd || mediaItem.duration}
                                  onChange={(e) => handleVideoTrimChange(mediaItem._id, 'trimEnd', Number(e.target.value))}
                                  className="w-12 bg-[#0B0F1A] border border-[#1A2235] rounded px-1 py-0.5 text-white"
                                />
                              </div>
                            </div>
                         </div>
                         <div className="absolute top-2 left-2 px-1.5 py-0.5 bg-black/60 rounded text-[#00D4FF] font-mono text-[10px] font-bold backdrop-blur-sm">
                           {mediaItem.duration}s
                         </div>
                       </>
                      )}
                     <button
                       onClick={() => removeSequenceItem(item._id)}
                       className="absolute top-2 right-2 p-1.5 bg-black/60 hover:bg-red-600 text-white rounded-lg opacity-0 group-hover:opacity-100 transition-opacity backdrop-blur-sm"
                       aria-label="Remove from sequence"
                     >
                       <Trash2 className="h-3.5 w-3.5" />
                     </button>
                   </m.div>
                   );
                 })}
                 <button
                   onClick={() => triggerUpload('video', true)}
                   className="relative bg-[#0B0F1A] rounded-xl border border-dashed border-[#1A2235] hover:border-[#00D4FF] aspect-[9/16] text-[#00D4FF] text-xs font-bold flex flex-col items-center justify-center gap-2 transition-colors"
                 >
                   <Video className="h-6 w-6" />
                   Add Video
                 </button>
                 <button
                   onClick={() => triggerUpload('image', true)}
                   className="relative bg-[#0B0F1A] rounded-xl border border-dashed border-[#1A2235] hover:border-[#FF4FD8] aspect-[9/16] text-[#FF4FD8] text-xs font-bold flex flex-col items-center justify-center gap-2 transition-colors"
                 >
                   <ImageIcon className="h-6 w-6" />
                   Add Image
                 </button>
               </div>
             )}
             </div>
           </div>

           {/* Videos Section */}
           <div>
             <div className="flex items-center justify-between mb-6 border-b border-[#1A2235] pb-2">
               <div className="flex items-center">
                  <Film className="h-5 w-5 text-[#00D4FF] mr-2" />
                  <h2 className="text-xl font-bold text-white tracking-tight">Custom Videos</h2>
               </div>
               <button onClick={() => { setUploadType('video'); fileInputRef.current?.click(); }} className="text-xs bg-[#00D4FF]/10 text-[#00D4FF] hover:bg-[#00D4FF]/20 px-3 py-1.5 rounded-lg flex items-center transition-colors">
                  <Upload className="w-3 h-3 mr-1" /> Add Video
               </button>
             </div>
             {videos.length === 0 ? (
               <div className="text-center py-10 bg-[#0B0F1A] border border-[#1A2235] border-dashed rounded-2xl text-slate-500">
                  <Video className="h-10 w-10 mx-auto mb-3 opacity-30" />
                  <p className="mb-4">No videos uploaded yet.</p>
                  <button
                    onClick={() => triggerUpload('video')}
                    className="px-4 py-2 rounded-lg text-sm font-bold text-white bg-[#00D4FF]/20 hover:bg-[#00D4FF]/30 border border-[#00D4FF]/40"
                  >
                    Add Video
                  </button>
               </div>
             ) : (
               <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-5 gap-4">
                 {videos.map(v => (
                   <m.div
                     key={v._id}
                     initial={{ opacity: 0 }}
                     animate={{ opacity: 1 }}
                     draggable={false}
                     onPointerDown={(e) => {
                       const target = e.target as HTMLElement | null;
                       if (target && target.closest('button')) return;
                       if (e.pointerType === 'touch') {
                         isTouchDeviceRef.current = true;
                         startTouchDrag(v._id);
                         return;
                       }
                       pointerPosRef.current = { x: e.clientX, y: e.clientY };
                       setPointerDragId(v._id);
                     }}
                     onPointerUp={cancelTouchDrag}
                     onPointerCancel={cancelTouchDrag}
                     onPointerLeave={cancelTouchDrag}
                     onDragOver={(e) => { e.preventDefault(); setDragOverId(v._id); }}
                     onDragLeave={() => { if (dragOverId === v._id) setDragOverId(null); }}
                     onDragEnd={() => { setDraggingId(null); setDragOverId(null); cancelTouchDrag(); }}
                     className={cn(
                       "group relative bg-[#111827] rounded-xl border border-[#1A2235] overflow-hidden aspect-[9/16] shadow-lg cursor-move transition-all duration-150 ease-out hover:-translate-y-0.5 hover:shadow-xl",
                       draggingId === v._id && "opacity-60 scale-[0.98] rotate-[0.3deg] shadow-2xl cursor-grabbing",
                       dragOverId === v._id && "ring-2 ring-[#00D4FF] ring-offset-2 ring-offset-[#0B0F1A] scale-[1.04]"
                     )}
                   >
                      <video
                        src={getMediaUrl(v.path)}
                        className="absolute inset-0 w-full h-full object-cover opacity-50 pointer-events-none"
                        preload="metadata"
                        muted
                        draggable={false}
                      />
                      <div className="absolute inset-0 bg-gradient-to-t from-[#0B0F1A] via-transparent to-transparent flex flex-col justify-end p-2 opacity-0 group-hover:opacity-100 transition-opacity">
                         <span className="text-[10px] text-white truncate w-full drop-shadow-md">{v.originalName}</span>
                         <div className="flex flex-col gap-1 mt-1">
                           <div className="flex items-center justify-between text-[10px] text-slate-300">
                             <span>Start (s)</span>
                             <input
                               type="number"
                               min={0}
                               max={v.duration}
                               step={0.1}
                               value={v.trimStart || 0}
                               onChange={(e) => handleVideoTrimChange(v._id, 'trimStart', Number(e.target.value))}
                               className="w-12 bg-[#0B0F1A] border border-[#1A2235] rounded px-1 py-0.5 text-white"
                             />
                           </div>
                           <div className="flex items-center justify-between text-[10px] text-slate-300">
                             <span>End (s)</span>
                             <input
                               type="number"
                               min={0}
                               max={v.duration}
                               step={0.1}
                               value={v.trimEnd || v.duration}
                               onChange={(e) => handleVideoTrimChange(v._id, 'trimEnd', Number(e.target.value))}
                               className="w-12 bg-[#0B0F1A] border border-[#1A2235] rounded px-1 py-0.5 text-white"
                             />
                           </div>
                         </div>
                      </div>
                      <div className="absolute top-2 left-2 px-1.5 py-0.5 bg-black/60 rounded text-[#00D4FF] font-mono text-[10px] font-bold backdrop-blur-sm">
                        {v.duration}s
                      </div>
                      <button
                        onClick={() => addToSequence(v._id)}
                        className="absolute top-2 right-2 rounded-lg bg-[#00D4FF]/80 p-1.5 text-white opacity-0 backdrop-blur-sm transition-opacity group-hover:opacity-100 hover:bg-[#00D4FF]"
                        aria-label={`Add video ${v.originalName} to sequence`}
                      >
                        <Upload className="h-3.5 w-3.5" />
                      </button>
                      <button onClick={() => handleDelete(v._id)} className="absolute bottom-2 right-2 p-1.5 bg-red-500/80 hover:bg-red-600 text-white rounded-lg opacity-0 group-hover:opacity-100 transition-opacity backdrop-blur-sm">
                         <Trash2 className="h-3.5 w-3.5" />
                      </button>
                   </m.div>
                 ))}
                 <button
                   onClick={() => triggerUpload('video')}
                   className="relative bg-[#0B0F1A] rounded-xl border border-dashed border-[#1A2235] hover:border-[#00D4FF] aspect-[9/16] text-[#00D4FF] text-sm font-bold flex flex-col items-center justify-center gap-2 transition-colors"
                 >
                   <Video className="h-6 w-6" />
                   Add Video
                 </button>
               </div>
             )}
           </div>

           {/* Images Section */}
           <div>
             <div className="flex items-center justify-between mb-6 border-b border-[#1A2235] pb-2">
               <div className="flex items-center">
                  <ImageIcon className="h-5 w-5 text-[#FF4FD8] mr-2" />
                  <h2 className="text-xl font-bold text-white tracking-tight">Custom Images</h2>
               </div>
               <button onClick={() => { setUploadType('image'); fileInputRef.current?.click(); }} className="text-xs bg-[#FF4FD8]/10 text-[#FF4FD8] hover:bg-[#FF4FD8]/20 px-3 py-1.5 rounded-lg flex items-center transition-colors">
                  <Upload className="w-3 h-3 mr-1" /> Add Image
               </button>
             </div>
             {images.length === 0 ? (
               <div className="text-center py-10 bg-[#0B0F1A] border border-[#1A2235] border-dashed rounded-2xl text-slate-500">
                  <ImageIcon className="h-10 w-10 mx-auto mb-3 opacity-30" />
                  <p className="mb-4">No images uploaded yet.</p>
                  <button
                    onClick={() => triggerUpload('image')}
                    className="px-4 py-2 rounded-lg text-sm font-bold text-white bg-[#FF4FD8]/20 hover:bg-[#FF4FD8]/30 border border-[#FF4FD8]/40"
                  >
                    Add Image
                  </button>
               </div>
             ) : (
               <div className="grid grid-cols-3 md:grid-cols-5 lg:grid-cols-6 gap-4">
                 {images.map(img => (
                   <m.div
                     key={img._id}
                     initial={{ opacity: 0 }}
                     animate={{ opacity: 1 }}
                     draggable={false}
                     onPointerDown={(e) => {
                       const target = e.target as HTMLElement | null;
                       if (target && target.closest('button')) return;
                       if (e.pointerType === 'touch') {
                         isTouchDeviceRef.current = true;
                         startTouchDrag(img._id);
                         return;
                       }
                       pointerPosRef.current = { x: e.clientX, y: e.clientY };
                       setPointerDragId(img._id);
                     }}
                     onPointerUp={cancelTouchDrag}
                     onPointerCancel={cancelTouchDrag}
                     onPointerLeave={cancelTouchDrag}
                     onDragOver={(e) => { e.preventDefault(); setDragOverId(img._id); }}
                     onDragLeave={() => { if (dragOverId === img._id) setDragOverId(null); }}
                     onDragEnd={() => { setDraggingId(null); setDragOverId(null); cancelTouchDrag(); }}
                     className={cn(
                       "group relative bg-[#111827] rounded-xl border border-[#1A2235] overflow-hidden aspect-square shadow-lg cursor-move transition-all duration-150 ease-out hover:-translate-y-0.5 hover:shadow-xl",
                       draggingId === img._id && "opacity-60 scale-[0.98] rotate-[0.3deg] shadow-2xl cursor-grabbing",
                       dragOverId === img._id && "ring-2 ring-[#FF4FD8] ring-offset-2 ring-offset-[#0B0F1A] scale-[1.04]"
                     )}
                   >
                      <img
                        src={getMediaUrl(img.path)}
                        alt={img.originalName}
                        className="absolute inset-0 w-full h-full object-cover pointer-events-none"
                        draggable={false}
                        loading="lazy"
                        decoding="async"
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
                               id="max-videos-per-day-mobile"
                               aria-label="Max videos per day"
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
                      <button
                        onClick={() => addToSequence(img._id)}
                        className="absolute top-2 right-2 rounded-lg bg-[#FF4FD8]/80 p-1.5 text-white opacity-0 backdrop-blur-sm transition-opacity group-hover:opacity-100 hover:bg-[#FF4FD8]"
                        aria-label={`Add image ${img.originalName} to sequence`}
                      >
                        <Upload className="h-3.5 w-3.5" />
                      </button>
                      <button aria-label={`Delete image ${img.originalName}`} onClick={() => handleDelete(img._id)} className="absolute bottom-2 right-2 p-1.5 bg-red-500/80 hover:bg-red-600 text-white rounded-lg opacity-0 group-hover:opacity-100 transition-opacity backdrop-blur-sm">
                         <Trash2 className="h-3.5 w-3.5" />
                      </button>
                   </m.div>
                 ))}
                 <button
                   onClick={() => triggerUpload('image')}
                   className="relative bg-[#0B0F1A] rounded-xl border border-dashed border-[#1A2235] hover:border-[#FF4FD8] aspect-square text-[#FF4FD8] text-sm font-bold flex flex-col items-center justify-center gap-2 transition-colors"
                 >
                   <ImageIcon className="h-6 w-6" />
                   Add Image
                 </button>
               </div>
             )}
           </div>

           {/* Thumbnails Section */}
           <div>
             <div className="flex items-center justify-between mb-6 border-b border-[#1A2235] pb-2">
               <div className="flex items-center">
                  <ImageIcon className="h-5 w-5 text-emerald-400 mr-2" />
                  <h2 className="text-xl font-bold text-white tracking-tight">Custom Thumbnails</h2>
               </div>
               <button onClick={() => { setUploadType('thumbnail'); fileInputRef.current?.click(); }} className="text-xs bg-emerald-400/10 text-emerald-400 hover:bg-emerald-400/20 px-3 py-1.5 rounded-lg flex items-center transition-colors">
                  <Upload className="w-3 h-3 mr-1" /> Add Thumbnail
               </button>
             </div>
             {thumbnails.length === 0 ? (
               <div className="text-center py-10 bg-[#0B0F1A] border border-[#1A2235] border-dashed rounded-2xl text-slate-500">
                  <ImageIcon className="h-10 w-10 mx-auto mb-3 opacity-30" />
                  <p>No thumbnails uploaded yet.</p>
               </div>
             ) : (
               <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-5 gap-4">
                 {thumbnails.map(img => (
                   <m.div key={img._id} initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="group relative bg-[#111827] rounded-xl border border-[#1A2235] overflow-hidden aspect-video shadow-lg">
                      <NextImage loading="lazy"
                        src={getMediaUrl(img.path)}
                        alt={img.originalName}
                        fill
                        className="object-cover"
                        unoptimized
                      />
                      <div className="absolute inset-0 bg-gradient-to-t from-[#0B0F1A]/80 to-transparent flex items-end p-2 opacity-0 group-hover:opacity-100 transition-opacity">
                         <span className="text-[10px] text-white truncate w-full">{img.originalName}</span>
                      </div>
                      <button aria-label={`Delete image ${img.originalName}`} onClick={() => handleDelete(img._id)} className="absolute top-2 right-2 p-1.5 bg-red-500/80 hover:bg-red-600 text-white rounded-lg opacity-0 group-hover:opacity-100 transition-opacity backdrop-blur-sm">
                         <Trash2 className="h-3.5 w-3.5" />
                      </button>
                   </m.div>
                 ))}
               </div>
             )}
           </div>

        </div>

        {pointerDragId && (() => {
          const item = mediaById.get(pointerDragId);
          if (!item) return null;
          const isImage = item.type === 'image' || item.type === 'thumbnail';
          return (
            <div
              ref={ghostRef}
              className="fixed z-[1000] pointer-events-none"
              style={{ left: 0, top: 0, transform: 'translate(-50%, -50%)' }}
            >
              {isImage ? (
                <img
                  src={getMediaUrl(item.path)}
                  alt={item.originalName}
                  className="h-24 w-16 object-cover rounded-lg border border-[#1A2235] shadow-2xl"
                  loading="lazy"
                  decoding="async"
                />
              ) : (
                <div className="h-24 w-16 bg-[#111827] rounded-lg border border-[#1A2235] shadow-2xl flex items-center justify-center text-[10px] text-slate-200">
                  Video
                </div>
              )}
            </div>
          );
        })()}

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
                  {previewType === 'images' ? 'Images Preview (9:16)' : previewType === 'videos' ? 'Videos Preview (9:16)' : 'Sequence Preview (9:16)'}
                </h3>
                <div className="flex items-center gap-3">
                  <label className="flex items-center gap-2 text-[10px] text-slate-300">
                    <input
                      type="checkbox"
                      checked={loopPreview}
                      onChange={(e) => setLoopPreview(e.target.checked)}
                      className="h-3 w-3 rounded border border-[#1A2235] bg-[#0B0F1A]"
                    />
                    Loop
                  </label>
                  <button onClick={closePreview} className="text-xs text-slate-300 hover:text-white">Close</button>
                </div>
              </div>
              <div className="p-3">
                <div className="w-full aspect-[9/16] bg-black rounded-xl overflow-hidden border border-[#1A2235] flex items-center justify-center">
                  {previewType === 'images' && images.length > 0 && (
                    (() => {
                      const item = images[previewIndex % images.length];
                      return (
                        <img
                          src={getMediaUrl(item.path)}
                          alt={item.originalName}
                          className="w-full h-full object-cover"
                          loading="lazy"
                          decoding="async"
                        />
                      );
                    })()
                  )}
                  {previewType === 'videos' && videos.length > 0 && (
                    <video
                      key={videos[previewIndex % videos.length]?._id}
                      src={getMediaUrl(videos[previewIndex % videos.length]?.path)}
                      className="w-full h-full object-cover"
                      controls
                      autoPlay
                      onEnded={advancePreview}
                    />
                  )}
                  {previewType === 'sequence' && sequenceItems.filter(item => item?.media).length > 0 && (
                    (() => {
                      const seq = sequenceList[previewIndex % sequenceItems.filter(item => item?.media).length];
                      const mediaItem = seq?.media;
                      if (!mediaItem) return null;
                      if (mediaItem.type === 'image') {
                        return (
                          <img
                            src={getMediaUrl(mediaItem.path)}
                            alt={mediaItem.originalName}
                            className="w-full h-full object-cover"
                            loading="lazy"
                            decoding="async"
                          />
                        );
                      }
                      return (
                        <video
                          key={seq?._id}
                          src={getMediaUrl(mediaItem.path)}
                          className="w-full h-full object-cover"
                          controls
                          autoPlay
                          onEnded={advancePreview}
                        />
                      );
                    })()
                  )}
                </div>
                <div className="mt-2 flex items-center justify-between text-[10px] text-slate-400">
                  <span>
                    {previewType === 'images'
                      ? 'Auto-play based on image duration.'
                      : previewType === 'videos'
                      ? 'Auto-advance when clip ends.'
                      : 'Plays items in order. Images use duration, videos play to end.'}
                  </span>
                  <span>{previewIndex + 1} / {getPreviewLength() || 0}</span>
                </div>
              </div>
            </div>
          </div>
        )}

      </div>
    </DashboardLayout>
  );
}
