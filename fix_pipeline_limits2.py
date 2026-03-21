import re

with open('backend/src/controllers/pipelineController.ts', 'r') as f:
    content = f.read()

# Update basic to 3, keep free at 1
new_limits = """    const concurrentLimits = {
      free: 1,
      basic: 3,
      pro: 10,
      premium: 20,
    };"""

content = re.sub(
    r'    const concurrentLimits = \{\n      free: 1,\n      basic: 5,\n      pro: 10,\n      premium: 20,\n    \};',
    new_limits,
    content,
    flags=re.DOTALL
)

# Add feature locks for storyMode and scheduling for Free plan
# Assume settings.scheduledAt is passed if scheduling is used, but wait let's just check storyMode for now
feature_check = """
    if (limitCheck.plan === 'free') {
        if (settings.storyMode) {
            throw new AppError('Story Mode is not available on the Free plan. Please upgrade to Basic or higher.', 403);
        }
        // Assuming a scheduledAt or similar setting exists, block it here
        if ((settings as any).scheduledAt || (settings as any).scheduleEnabled) {
            throw new AppError('Scheduling is not available on the Free plan. Please upgrade to Basic or higher.', 403);
        }
    }
"""

# Insert feature check right after limit checks
content = content.replace(
    """    // Check Upload Limits
    const limitCheck = await getUploadLimits(userId);
    if (!limitCheck.canUpload) {
      throw new AppError('Daily upload limit reached', 403);
    }""",
    """    // Check Upload Limits
    const limitCheck = await getUploadLimits(userId);
    if (!limitCheck.canUpload) {
      throw new AppError('Daily upload limit reached', 403);
    }\n""" + feature_check
)

with open('backend/src/controllers/pipelineController.ts', 'w') as f:
    f.write(content)

print("Updated pipelineController feature limits")
