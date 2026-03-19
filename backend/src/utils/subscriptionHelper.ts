import { IUser } from '../models/User';

/**
 * Checks if the user's subscription has expired.
 * If expired, updates the user's plan to 'free' and saves the document.
 * @param user The user document to check.
 * @returns A promise that resolves to the updated user document (or the original if no update was needed).
 */
export const checkAndUpdateUserPlan = async (user: any): Promise<any> => {
  if (user.subscriptionExpiresAt && new Date() > user.subscriptionExpiresAt) {
    user.plan = 'free';
    user.subscriptionExpiresAt = undefined;
    await user.save();
  }
  return user;
};
