import SystemConfig from '../models/SystemConfig';
import {
  sanitizePipelineRetriesByPlan,
  sanitizePipelineRunnerFallbackOrder,
} from '../services/pipelineRetryPolicyService';
import { sanitizePipelineConcurrencyByPlan } from '../services/pipelineConcurrencyPolicyService';
import {
  sanitizeJobHistoryLimitByPlan,
  sanitizeJobHistoryMinAgeDays,
} from '../services/jobHistoryRetentionPolicyService';

export const ensureSystemConfigSingleton = async (): Promise<void> => {
  const latest = await SystemConfig.findOne().sort({ updatedAt: -1 });
  if (!latest) {
    await SystemConfig.create({
      betaMode: false,
      pipelineConcurrencyByPlan: sanitizePipelineConcurrencyByPlan(undefined),
      pipelineRetriesByPlan: sanitizePipelineRetriesByPlan(undefined),
      pipelineRunnerFallbackOrder: sanitizePipelineRunnerFallbackOrder(undefined),
      jobHistoryLimitByPlan: sanitizeJobHistoryLimitByPlan(undefined),
      jobHistoryMinAgeDays: sanitizeJobHistoryMinAgeDays(undefined),
    });
    return;
  }

  await SystemConfig.updateOne(
    { _id: latest._id },
    {
      $set: {
        pipelineConcurrencyByPlan: sanitizePipelineConcurrencyByPlan((latest as any).pipelineConcurrencyByPlan),
        pipelineRetriesByPlan: sanitizePipelineRetriesByPlan((latest as any).pipelineRetriesByPlan),
        pipelineRunnerFallbackOrder: sanitizePipelineRunnerFallbackOrder((latest as any).pipelineRunnerFallbackOrder),
        jobHistoryLimitByPlan: sanitizeJobHistoryLimitByPlan((latest as any).jobHistoryLimitByPlan),
        jobHistoryMinAgeDays: sanitizeJobHistoryMinAgeDays((latest as any).jobHistoryMinAgeDays),
      },
    }
  );

  await SystemConfig.deleteMany({ _id: { $ne: latest._id } });
};
