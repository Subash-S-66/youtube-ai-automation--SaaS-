import { IUser } from '../models/User';

export const resetDailyUploads = (user: IUser): boolean => {
  const now = new Date();
  const lastReset = new Date(user.lastUploadReset);

  // Check if dates are on the same day (ignoring time)
  const isSameDay =
    now.getFullYear() === lastReset.getFullYear() &&
    now.getMonth() === lastReset.getMonth() &&
    now.getDate() === lastReset.getDate();

  if (!isSameDay) {
    user.uploadsUsedToday = 0;
    user.lastUploadReset = now;
    return true; // Indicates the user was modified
  }

  return false;
};
