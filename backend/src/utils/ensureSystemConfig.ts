import SystemConfig from '../models/SystemConfig';
import {
  sanitizePipelineRetriesByPlan,
  sanitizePipelineRunnerFallbackOrder,
} from '../services/pipelineRetryPolicyService';

export const ensureSystemConfigSingleton = async (): Promise<void> => {
  const latest = await SystemConfig.findOne().sort({ updatedAt: -1 });
  if (!latest) {
    await SystemConfig.create({
      betaMode: false,
      pipelineRetriesByPlan: sanitizePipelineRetriesByPlan(undefined),
      pipelineRunnerFallbackOrder: sanitizePipelineRunnerFallbackOrder(undefined),
    });
    return;
  }

  await SystemConfig.deleteMany({ _id: { $ne: latest._id } });
};
