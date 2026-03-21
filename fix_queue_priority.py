import re

with open('backend/src/controllers/pipelineController.ts', 'r') as f:
    content = f.read()

# Requirement: priority queue working (Premium > Pro > Basic > Free)
# In BullMQ, lower numbers mean higher priority.
# Premium: 1, Pro: 2, Basic: 3, Free: 4

priority_mapping = """
    const planPriorities: Record<string, number> = {
      premium: 1,
      pro: 2,
      basic: 3,
      free: 4,
    };
    const jobPriority = planPriorities[finalLimitCheck.plan] || 4;

    // Add job to BullMQ
    await pipelineQueue.add('runPipeline', {
      userId,
      promptId,
      jobId: job._id.toString(),
      settings,
    }, {
      priority: jobPriority,
      jobId: job._id.toString(), // Ensure idempotency
"""

content = re.sub(
    r'    // Add job to BullMQ\n    await pipelineQueue\.add\(\'runPipeline\', \{\n      userId,\n      promptId,\n      jobId: job\._id\.toString\(\),\n      settings,\n    \}, \{',
    priority_mapping.strip() + ' {',
    content,
    flags=re.DOTALL
)

with open('backend/src/controllers/pipelineController.ts', 'w') as f:
    f.write(content)

print("Updated queue priorities.")
