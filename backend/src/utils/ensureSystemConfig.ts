import SystemConfig from '../models/SystemConfig';

export const ensureSystemConfigSingleton = async (): Promise<void> => {
  const latest = await SystemConfig.findOne().sort({ updatedAt: -1 });
  if (!latest) {
    await SystemConfig.create({ betaMode: false });
    return;
  }

  await SystemConfig.deleteMany({ _id: { $ne: latest._id } });
};
