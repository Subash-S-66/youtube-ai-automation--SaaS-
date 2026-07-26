import { Request, Response } from 'express';
import asyncHandler from '../utils/asyncHandler';
import { AppError } from '../middleware/errorHandler';
import Media from '../models/Media';
import MediaSequence from '../models/MediaSequence';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import jwt from 'jsonwebtoken';
import { getUploadLimits } from '../services/uploadLimitService';

// @desc    Upload new media
// @route   POST /api/media/upload
// @access  Private
import { execFile } from 'child_process';
import { promisify } from 'util';

const execFileAsync = promisify(execFile);

interface MediaPolicy {
  plan: string;
  maxMediaItems: number;
  maxVideoItems: number;
  maxImageItems: number;
  maxThumbnailItems: number;
  maxClipLengthSeconds: number;
  maxTotalVideoDurationSeconds: number;
}

const resolvePolicyNumber = (value: unknown, fallback: number, min = 0, max = 100000): number => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    return fallback;
  }
  return Math.max(min, Math.min(max, Math.floor(parsed)));
};

const buildMediaPolicy = (limitCheck: any): MediaPolicy => {
  const limits = (limitCheck?.planLimits && typeof limitCheck.planLimits === 'object')
    ? (limitCheck.planLimits as Record<string, unknown>)
    : {};

  return {
    plan: String(limitCheck?.plan || 'free').toLowerCase(),
    maxMediaItems: resolvePolicyNumber(limits.max_media_items, 10, 1, 5000),
    maxVideoItems: resolvePolicyNumber(limits.max_video_items, 10, 1, 5000),
    maxImageItems: resolvePolicyNumber(limits.max_image_items, 20, 1, 5000),
    maxThumbnailItems: resolvePolicyNumber(limits.max_thumbnail_items, 10, 1, 5000),
    maxClipLengthSeconds: resolvePolicyNumber(limits.max_clip_length_seconds, 70, 1, 7200),
    maxTotalVideoDurationSeconds: resolvePolicyNumber(limits.max_total_video_duration_seconds, 70, 1, 86400),
  };
};

const requireCustomMediaPolicy = async (userId: string): Promise<MediaPolicy> => {
  const limitCheck = await getUploadLimits(userId);
  const canUseCustomMedia = Boolean(limitCheck?.features?.custom_media);
  if (!canUseCustomMedia) {
    throw new AppError('Custom media is not enabled for your current subscription plan.', 403);
  }
  return buildMediaPolicy(limitCheck);
};

async function detectFileType(filePath: string) {
  const mod = await import('file-type');
  return mod.fileTypeFromFile(filePath);
}

async function probeVideoDuration(filePath: string): Promise<number> {
  try {
    const { stdout } = await execFileAsync('ffprobe', [
      '-v',
      'error',
      '-show_entries',
      'format=duration',
      '-of',
      'default=noprint_wrappers=1:nokey=1',
      filePath,
    ]);
    const parsed = parseFloat(stdout.trim());
    if (isNaN(parsed) || parsed <= 0) {
      throw new Error('Invalid duration from ffprobe');
    }
    return Math.ceil(parsed);
  } catch (err) {
    console.warn(`[mediaController] ffprobe failed for ${filePath}:`, err);
    return -1; // Signal that probe failed
  }
}

export const uploadMedia = asyncHandler(async (req: Request, res: Response) => {
  if (!req.file) {
    throw new AppError('No file uploaded', 400);
  }

  const userId = String(req.user?.id || '').trim();
  if (!userId) {
    throw new AppError('Not authorized', 401);
  }

  const mediaPolicy = await requireCustomMediaPolicy(userId);

  // Validate file type properly
  try {
    const fileType = await detectFileType(req.file.path);
    if (!fileType || (!fileType.mime.startsWith('video/') && !fileType.mime.startsWith('image/'))) {
      fs.unlinkSync(req.file.path);
      throw new AppError('Invalid file type detected. Only videos and images are allowed.', 400);
    }
    if (fileType.mime !== req.file.mimetype) {
      fs.unlinkSync(req.file.path); // FIXED: Remove suspicious upload immediately on MIME mismatch.
      throw new AppError('File type mismatch detected', 400); // FIXED: Reject payloads with mismatched header/content types.
    }
  } catch (err: any) {
    if (fs.existsSync(req.file.path)) fs.unlinkSync(req.file.path);
    throw new AppError(err.message || 'Error validating file type', err.statusCode || 500);
  }

  const file = req.file;
  const isVideo = file.mimetype.startsWith('video/');

  // Default type determination, overridden by explicit client request for thumbnails
  let type: 'video' | 'image' | 'thumbnail' = isVideo ? 'video' : 'image';

  if (req.body.type === 'thumbnail') {
    if (isVideo) {
      fs.unlinkSync(file.path);
      throw new AppError('Thumbnails must be an image file.', 400);
    }
    type = 'thumbnail';
  }

  // Enforce limits
  const currentTotalMediaCount = await Media.countDocuments({ userId });
  if (currentTotalMediaCount >= mediaPolicy.maxMediaItems) {
    fs.unlinkSync(file.path);
    throw new AppError(
      `You have reached your media library limit (${mediaPolicy.maxMediaItems}) for plan ${mediaPolicy.plan}.`,
      400
    );
  }

  if (type === 'image') {
    const currentImagesCount = await Media.countDocuments({ userId, type: 'image' });
    if (currentImagesCount >= mediaPolicy.maxImageItems) {
      fs.unlinkSync(file.path);
      throw new AppError(
        `You have reached your image limit (${mediaPolicy.maxImageItems}) for plan ${mediaPolicy.plan}.`,
        400
      );
    }
  } else if (type === 'thumbnail') {
    const currentThumbnailCount = await Media.countDocuments({ userId, type: 'thumbnail' });
    if (currentThumbnailCount >= mediaPolicy.maxThumbnailItems) {
      fs.unlinkSync(file.path);
      throw new AppError(
        `You have reached your thumbnail limit (${mediaPolicy.maxThumbnailItems}) for plan ${mediaPolicy.plan}.`,
        400
      );
    }
  }

  let duration = 0;
  if (type === 'video') {
      const currentVideosCount = await Media.countDocuments({ userId, type: 'video' });
      if (currentVideosCount >= mediaPolicy.maxVideoItems) {
        fs.unlinkSync(file.path);
        throw new AppError(
          `You have reached your video clip limit (${mediaPolicy.maxVideoItems}) for plan ${mediaPolicy.plan}.`,
          400
        );
      }

      const probedDuration = await probeVideoDuration(file.path);
      if (probedDuration > 0) {
        duration = probedDuration;
        if (duration > mediaPolicy.maxClipLengthSeconds) {
          fs.unlinkSync(file.path);
          throw new AppError(
            `Video duration (${duration}s) exceeds your per-clip limit (${mediaPolicy.maxClipLengthSeconds}s) for plan ${mediaPolicy.plan}.`,
            400
          );
        }
      } else {
        // ffprobe unavailable - fall back to client-reported value with policy cap
        const clientDuration = Number(req.body.duration) || 0;
        duration = Math.min(clientDuration, mediaPolicy.maxClipLengthSeconds);
        console.warn(`[mediaController] ffprobe unavailable, trusting client duration: ${duration}s`);
      }

      const currentVideos = await Media.find({ userId, type: 'video' });
      const currentTotalDuration = currentVideos.reduce((acc, curr) => acc + (curr.duration || 0), 0);

      if (currentTotalDuration + duration > mediaPolicy.maxTotalVideoDurationSeconds) {
         fs.unlinkSync(file.path);
         throw new AppError(
           `Cannot upload. Maximum total video duration is ${mediaPolicy.maxTotalVideoDurationSeconds}s for plan ${mediaPolicy.plan}. You currently have ${currentTotalDuration}s used.`,
           400
         );
      }
  }

  const mediaPayload: any = {
    userId,
    type,
    filename: file.filename,
    originalName: file.originalname,
    size: file.size,
    duration,
    sortOrder: Date.now(),
    path: `uploads/${file.filename}`,
  };
  if (type === 'image') {
    mediaPayload.imageDuration = 3;
  }

  const media = await Media.create(mediaPayload);

  res.status(201).json({
    success: true,
    data: media,
  });
});

// @desc    Get user media
// @route   GET /api/media
// @access  Private
export const getMedia = asyncHandler(async (req: Request, res: Response) => {
  const userId = String(req.user?.id || '').trim();
  if (!userId) {
    throw new AppError('Not authorized', 401);
  }

  const mediaPolicy = await requireCustomMediaPolicy(userId);
  const media = await Media.find({ userId }).sort({ sortOrder: 1, createdAt: -1 });
  const missingOrder = media.filter(m => m.sortOrder === undefined || m.sortOrder === null);
  if (missingOrder.length > 0) {
    const bulk = Media.collection.initializeUnorderedBulkOp();
    missingOrder.forEach(m => {
      bulk.find({ _id: m._id }).updateOne({ $set: { sortOrder: m.createdAt ? m.createdAt.getTime() : Date.now() } });
    });
    if (bulk.length > 0) {
      try {
        await bulk.execute();
      } catch {
        // ignore bulk update errors
      }
    }
  }
  res.status(200).json({
    success: true,
    data: media,
    policy: mediaPolicy,
  });
});

// @desc    Get sequence items (videos + images)
// @route   GET /api/media/sequence
// @access  Private
export const getSequence = asyncHandler(async (req: Request, res: Response) => {
  const userId = String(req.user?.id || '').trim();
  if (!userId) {
    throw new AppError('Not authorized', 401);
  }
  await requireCustomMediaPolicy(userId);

  const items = await MediaSequence.find({ userId })
    .sort({ sortOrder: 1, createdAt: 1 })
    .populate('mediaId');

  const data = items.map((item: any) => ({
    _id: item._id,
    mediaId: item.mediaId?._id,
    type: item.type,
    sortOrder: item.sortOrder,
    media: item.mediaId,
  }));

  res.status(200).json({ success: true, data });
});

// @desc    Add media item to sequence (allows duplicates)
// @route   POST /api/media/sequence
// @access  Private
export const addToSequence = asyncHandler(async (req: Request, res: Response) => {
  const userId = String(req.user?.id || '').trim();
  if (!userId) {
    throw new AppError('Not authorized', 401);
  }
  await requireCustomMediaPolicy(userId);

  const { mediaId } = req.body || {};
  if (!mediaId) {
    throw new AppError('mediaId is required', 400);
  }

  const media = await Media.findOne({ _id: mediaId, userId });
  if (!media) {
    throw new AppError('Media not found', 404);
  }
  if (media.type === 'thumbnail') {
    throw new AppError('Thumbnails cannot be added to the sequence', 400);
  }

  const created = await MediaSequence.create({
    userId,
    mediaId: media._id,
    type: media.type,
    sortOrder: Date.now(),
  });

  const populated = await MediaSequence.findById(created._id).populate('mediaId');

  res.status(201).json({
    success: true,
    data: {
      _id: populated?._id,
      mediaId: populated?.mediaId?._id,
      type: populated?.type,
      sortOrder: populated?.sortOrder,
      media: populated?.mediaId,
    },
  });
});

// @desc    Reorder sequence items
// @route   POST /api/media/sequence/reorder
// @access  Private
export const reorderSequence = asyncHandler(async (req: Request, res: Response) => {
  const userId = String(req.user?.id || '').trim();
  if (!userId) {
    throw new AppError('Not authorized', 401);
  }
  await requireCustomMediaPolicy(userId);

  const { orderedIds } = req.body || {};
  if (!Array.isArray(orderedIds)) {
    throw new AppError('orderedIds are required', 400);
  }

  const items = await MediaSequence.find({ userId, _id: { $in: orderedIds } }).select('_id');
  if (items.length !== orderedIds.length) {
    throw new AppError('Some sequence items were not found', 404);
  }

  const bulk = MediaSequence.collection.initializeUnorderedBulkOp();
  orderedIds.forEach((id: string, index: number) => {
    bulk.find({ _id: id, userId }).updateOne({ $set: { sortOrder: index } });
  });
  if (bulk.length > 0) {
    await bulk.execute();
  }

  res.status(200).json({ success: true });
});

// @desc    Remove a sequence item
// @route   DELETE /api/media/sequence/:id
// @access  Private
export const deleteSequenceItem = asyncHandler(async (req: Request, res: Response) => {
  const userId = String(req.user?.id || '').trim();
  if (!userId) {
    throw new AppError('Not authorized', 401);
  }
  await requireCustomMediaPolicy(userId);

  const seqId = req.params.id;
  if (!seqId) {
    throw new AppError('Sequence item ID is required', 400);
  }

  const deleted = await MediaSequence.findOneAndDelete({ _id: seqId, userId });
  if (!deleted) {
    throw new AppError('Sequence item not found', 404);
  }

  res.status(200).json({ success: true });
});

// @desc    Update media metadata (image duration, sort order)
// @route   PATCH /api/media/:id
// @access  Private
export const updateMedia = asyncHandler(async (req: Request, res: Response) => {
  const userId = String(req.user?.id || '').trim();
  if (!userId) {
    throw new AppError('Not authorized', 401);
  }
  await requireCustomMediaPolicy(userId);

  const mediaId = req.params.id;
  if (!mediaId) {
    throw new AppError('Media ID is required', 400);
  }

  const { imageDuration, sortOrder, trimStart, trimEnd } = req.body || {};

  const update: any = {};
  if (imageDuration !== undefined) {
    const parsed = Number(imageDuration);
    if (Number.isNaN(parsed) || parsed <= 0 || parsed > 15) {
      throw new AppError('Image duration must be between 1 and 15 seconds.', 400);
    }
    update.imageDuration = parsed;
  }
  if (trimStart !== undefined) {
    const parsed = Number(trimStart);
    if (!Number.isNaN(parsed) && parsed >= 0) {
      update.trimStart = parsed;
    }
  }
  if (trimEnd !== undefined) {
    const parsed = Number(trimEnd);
    if (!Number.isNaN(parsed) && parsed >= 0) {
      update.trimEnd = parsed;
    }
  }
  if (sortOrder !== undefined) {
    const parsed = Number(sortOrder);
    if (Number.isNaN(parsed)) {
      throw new AppError('Invalid sort order', 400);
    }
    update.sortOrder = parsed;
  }

  const updated = await Media.findOneAndUpdate(
    { _id: mediaId, userId },
    { $set: update },
    { returnDocument: 'after' }
  );

  if (!updated) {
    throw new AppError('Media not found', 404);
  }

  res.status(200).json({
    success: true,
    data: updated,
  });
});

// @desc    Reorder media items by type
// @route   POST /api/media/reorder
// @access  Private
export const reorderMedia = asyncHandler(async (req: Request, res: Response) => {
  const userId = String(req.user?.id || '').trim();
  if (!userId) {
    throw new AppError('Not authorized', 401);
  }
  await requireCustomMediaPolicy(userId);

  const { type, orderedIds } = req.body || {};
  if (!type || !Array.isArray(orderedIds)) {
    throw new AppError('type and orderedIds are required', 400);
  }

  const allowed = ['video', 'image', 'thumbnail'];
  if (!allowed.includes(type)) {
    throw new AppError('Invalid media type', 400);
  }

  const mediaDocs = await Media.find({ userId, type, _id: { $in: orderedIds } }).select('_id');
  if (mediaDocs.length !== orderedIds.length) {
    throw new AppError('Some media items were not found', 404);
  }

  const bulk = Media.collection.initializeUnorderedBulkOp();
  orderedIds.forEach((id: string, index: number) => {
    bulk.find({ _id: id, userId, type }).updateOne({ $set: { sortOrder: index } });
  });
  if (bulk.length > 0) {
    await bulk.execute();
  }

  res.status(200).json({ success: true });
});

// @desc    Reorder mixed media (videos + images)
// @route   POST /api/media/reorder-mixed
// @access  Private
export const reorderMixedMedia = asyncHandler(async (req: Request, res: Response) => {
  const userId = String(req.user?.id || '').trim();
  if (!userId) {
    throw new AppError('Not authorized', 401);
  }
  await requireCustomMediaPolicy(userId);

  const { orderedIds } = req.body || {};
  if (!Array.isArray(orderedIds)) {
    throw new AppError('orderedIds are required', 400);
  }

  const mediaDocs = await Media.find({
    userId,
    _id: { $in: orderedIds },
    type: { $in: ['video', 'image'] },
  }).select('_id');

  if (mediaDocs.length !== orderedIds.length) {
    throw new AppError('Some media items were not found', 404);
  }

  const bulk = Media.collection.initializeUnorderedBulkOp();
  orderedIds.forEach((id: string, index: number) => {
    bulk.find({ _id: id, userId }).updateOne({ $set: { sortOrder: index } });
  });
  if (bulk.length > 0) {
    await bulk.execute();
  }

  res.status(200).json({ success: true });
});

// @desc    Delete media
// @route   DELETE /api/media/:id
// @access  Private
// @desc    Get secure media file
// @route   GET /api/media/file/:filename
// @access  Private
export const getSecureMediaFile = asyncHandler(async (req: Request, res: Response) => {
  const { filename } = req.params;
  if (!filename || typeof filename !== 'string') {
    throw new AppError('Filename is required and must be a string', 400);
  }

  // Prevent path traversal
  const safeFilename = path.basename(filename);
  if (safeFilename !== filename) {
    throw new AppError('Invalid filename', 400);
  }

  const webhookSecret = req.headers['x-webhook-secret'];
  const expectedSecret = process.env.WEBHOOK_SECRET || '';
  let isWebhookAuthorized = false;
  if (typeof webhookSecret === 'string' && webhookSecret.length > 0 && expectedSecret.length > 0) {
    const providedBuffer = Buffer.from(webhookSecret);
    const expectedBuffer = Buffer.from(expectedSecret);
    if (providedBuffer.length === expectedBuffer.length) {
      isWebhookAuthorized = crypto.timingSafeEqual(providedBuffer, expectedBuffer);
    }
  }

  let jwtUserId = '';
  if (!isWebhookAuthorized) {
    let token = '';
    if (req.headers.authorization && req.headers.authorization.startsWith('Bearer')) {
      token = req.headers.authorization.split(' ')[1] || '';
    } else if (req.cookies && req.cookies.jwt) {
      token = req.cookies.jwt;
    }

    if (!token) {
      throw new AppError('Not authorized', 401);
    }

    try {
      const secret = process.env.JWT_SECRET || '';
      if (!secret) {
        throw new AppError('JWT secret is not configured', 500);
      }
      const decoded = jwt.verify(token, secret) as { id?: string };
      jwtUserId = decoded?.id || '';
    } catch {
      throw new AppError('Not authorized', 401);
    }
  }

  const mediaDoc = await Media.findOne({ filename: safeFilename }).select('userId filename');
  if (!mediaDoc) {
    throw new AppError('File not found', 404);
  }

  if (!isWebhookAuthorized && String(mediaDoc.userId) !== jwtUserId) {
    throw new AppError('Not authorized to access this file', 403);
  }

  const filePath = path.join(__dirname, '../../uploads', safeFilename);

  if (!fs.existsSync(filePath)) {
    throw new AppError('File not found', 404);
  }

  const fileStat = fs.statSync(filePath);
  const fileSize = fileStat.size;
  const rangeHeader = req.headers.range;

  res.type(filePath);
  res.setHeader('Accept-Ranges', 'bytes');

  if (rangeHeader) {
    const parsed = /^bytes=(\d*)-(\d*)$/.exec(rangeHeader);
    if (!parsed) {
      res.status(416);
      res.setHeader('Content-Range', `bytes */${fileSize}`);
      res.end();
      return;
    }

    const startRaw = parsed[1] || '';
    const endRaw = parsed[2] || '';
    let start = 0;
    let end = fileSize - 1;

    if (!startRaw && !endRaw) {
      res.status(416);
      res.setHeader('Content-Range', `bytes */${fileSize}`);
      res.end();
      return;
    }

    if (!startRaw && endRaw) {
      const suffixLength = Number.parseInt(endRaw, 10);
      if (!Number.isFinite(suffixLength) || suffixLength <= 0) {
        res.status(416);
        res.setHeader('Content-Range', `bytes */${fileSize}`);
        res.end();
        return;
      }
      start = Math.max(fileSize - suffixLength, 0);
    } else {
      start = Number.parseInt(startRaw, 10);
      end = endRaw ? Number.parseInt(endRaw, 10) : (fileSize - 1);
    }

    if (!Number.isFinite(start) || !Number.isFinite(end) || start < 0 || end < start || start >= fileSize) {
      res.status(416);
      res.setHeader('Content-Range', `bytes */${fileSize}`);
      res.end();
      return;
    }

    end = Math.min(end, fileSize - 1);
    const chunkSize = (end - start) + 1;

    res.status(206);
    res.setHeader('Content-Range', `bytes ${start}-${end}/${fileSize}`);
    res.setHeader('Content-Length', String(chunkSize));

    const partialStream = fs.createReadStream(filePath, { start, end });
    partialStream.on('error', () => {
      if (!res.headersSent) {
        res.status(500).end();
        return;
      }
      res.end();
    });
    partialStream.pipe(res);
    return;
  }

  res.setHeader('Content-Length', String(fileSize));
  const fullStream = fs.createReadStream(filePath);
  fullStream.on('error', () => {
    if (!res.headersSent) {
      res.status(500).end();
      return;
    }
    res.end();
  });
  fullStream.pipe(res);
});

export const deleteMedia = asyncHandler(async (req: Request, res: Response) => {
  const userId = String(req.user?.id || '').trim();
  if (!userId) {
    throw new AppError('Not authorized', 401);
  }
  await requireCustomMediaPolicy(userId);

  const mediaId = req.params.id;
  if (!mediaId) {
    throw new AppError('Media ID is required', 400);
  }

  const media = await Media.findOne({ _id: mediaId, userId });

  if (!media) {
    throw new AppError('Media not found', 404);
  }

  // Remove file from disk
  try {
    fs.unlinkSync(path.resolve(media.path));
  } catch (err) {
    console.warn(`Failed to delete file from disk: ${media.path}`, err);
    // Continue with DB deletion even if file is missing
  }

  await media.deleteOne();
  await MediaSequence.deleteMany({ userId, mediaId: media._id });

  res.status(200).json({
    success: true,
    message: 'Media deleted successfully',
  });
});
