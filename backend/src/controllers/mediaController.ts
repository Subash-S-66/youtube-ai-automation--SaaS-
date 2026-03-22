import { Request, Response } from 'express';
import asyncHandler from '../utils/asyncHandler';
import { AppError } from '../middleware/errorHandler';
import Media from '../models/Media';
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

  const media = await Media.create({
    userId: req.user?.id,
    type,
    filename: file.filename,
    originalName: file.originalname,
    size: file.size,
    duration,
    path: file.path,
  });

  res.status(201).json({
    success: true,
    data: media,
  });
});

// @desc    Get user media
// @route   GET /api/media
// @access  Private
export const getMedia = asyncHandler(async (req: Request, res: Response) => {
  const media = await Media.find({ userId: req.user?.id }).sort({ createdAt: -1 });
  res.status(200).json({
    success: true,
    data: media,
  });
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

  res.status(200).json({
    success: true,
    message: 'Media deleted successfully',
  });
});