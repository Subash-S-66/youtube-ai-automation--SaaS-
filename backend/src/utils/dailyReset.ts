import { IUser } from '../models/User';

export const resetDailyUploads = (user: IUser): boolean => {
  const now = new Date();
  const lastReset = new Date(user.lastUploadReset);

  // Compare using strict UTC date (YYYY-MM-DD)
  const isSameDayUTC =
    now.getUTCFullYear() === lastReset.getUTCFullYear() &&
    now.getUTCMonth() === lastReset.getUTCMonth() &&
    now.getUTCDate() === lastReset.getUTCDate();

  if (!isSameDayUTC) {
    user.uploadsUsedToday = 0;
    user.lastUploadReset = now;
    return true; // Indicates the user was modified
  }

  return false;
};
