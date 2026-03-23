import { Request, Response } from 'express';
import asyncHandler from '../utils/asyncHandler';
import { AppError } from '../middleware/errorHandler';
import Media from '../models/Media';
import MediaSequence from '../models/MediaSequence';
import fs from 'fs';
import path from 'path';

// @desc    Upload new media
// @route   POST /api/media/upload
// @access  Private
export const uploadMedia = asyncHandler(async (req: Request, res: Response) => {
  if (!req.file) {
    throw new AppError('No file uploaded', 400);
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
  if (type === 'image') {
    const currentImagesCount = await Media.countDocuments({ userId: req.user?.id, type: 'image' });
    if (currentImagesCount >= 20) {
      fs.unlinkSync(file.path);
      throw new AppError('You have reached the maximum limit of 20 uploaded images.', 400);
    }
  } else if (type === 'thumbnail') {
    const currentThumbnailCount = await Media.countDocuments({ userId: req.user?.id, type: 'thumbnail' });
    if (currentThumbnailCount >= 10) { // Limit thumbnails to 10 to prevent storage abuse
      fs.unlinkSync(file.path);
      throw new AppError('You have reached the maximum limit of 10 uploaded thumbnails. Delete some to add more.', 400);
    }
  }

  // Duration is passed from client. For a robust MVP, we trust it but cap it at 70
  let duration = 0;
  if (type === 'video') {
      duration = Number(req.body.duration) || 0;

      const currentVideos = await Media.find({ userId: req.user?.id, type: 'video' });
      const currentTotalDuration = currentVideos.reduce((acc, curr) => acc + (curr.duration || 0), 0);

      if (currentTotalDuration + duration > 70) {
         fs.unlinkSync(file.path);
         throw new AppError(`Cannot upload. Maximum total video duration allowed is 70 seconds. You currently have ${currentTotalDuration}s used.`, 400);
      }
  }

  const mediaPayload: any = {
    userId: req.user?.id,
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
  const media = await Media.find({ userId: req.user?.id }).sort({ sortOrder: 1, createdAt: -1 });
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
  });
});

// @desc    Get sequence items (videos + images)
// @route   GET /api/media/sequence
// @access  Private
export const getSequence = asyncHandler(async (req: Request, res: Response) => {
  const items = await MediaSequence.find({ userId: req.user?.id })
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
  const { mediaId } = req.body || {};
  if (!mediaId) {
    throw new AppError('mediaId is required', 400);
  }

  const media = await Media.findOne({ _id: mediaId, userId: req.user?.id });
  if (!media) {
    throw new AppError('Media not found', 404);
  }
  if (media.type === 'thumbnail') {
    throw new AppError('Thumbnails cannot be added to the sequence', 400);
  }

  const created = await MediaSequence.create({
    userId: req.user?.id,
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
  const { orderedIds } = req.body || {};
  if (!Array.isArray(orderedIds)) {
    throw new AppError('orderedIds are required', 400);
  }

  const userId = req.user?.id;
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
  const seqId = req.params.id;
  if (!seqId) {
    throw new AppError('Sequence item ID is required', 400);
  }

  const deleted = await MediaSequence.findOneAndDelete({ _id: seqId, userId: req.user?.id });
  if (!deleted) {
    throw new AppError('Sequence item not found', 404);
  }

  res.status(200).json({ success: true });
});

// @desc    Update media metadata (image duration, sort order)
// @route   PATCH /api/media/:id
// @access  Private
export const updateMedia = asyncHandler(async (req: Request, res: Response) => {
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
    { _id: mediaId, userId: req.user?.id },
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
  const { type, orderedIds } = req.body || {};
  if (!type || !Array.isArray(orderedIds)) {
    throw new AppError('type and orderedIds are required', 400);
  }

  const allowed = ['video', 'image', 'thumbnail'];
  if (!allowed.includes(type)) {
    throw new AppError('Invalid media type', 400);
  }

  const userId = req.user?.id;
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
  const { orderedIds } = req.body || {};
  if (!Array.isArray(orderedIds)) {
    throw new AppError('orderedIds are required', 400);
  }

  const userId = req.user?.id;
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
export const deleteMedia = asyncHandler(async (req: Request, res: Response) => {
  const mediaId = req.params.id;
  if (!mediaId) {
    throw new AppError('Media ID is required', 400);
  }

  const media = await Media.findOne({ _id: mediaId, userId: req.user?.id });

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
  await MediaSequence.deleteMany({ userId: req.user?.id, mediaId: media._id });

  res.status(200).json({
    success: true,
    message: 'Media deleted successfully',
  });
});
