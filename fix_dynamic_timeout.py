import re

with open('backend/src/controllers/pipelineController.ts', 'r') as f:
    content = f.read()

# Formula: 1 video = 10 min, 2 videos = 15 min. That's `10 + (count - 1) * 5`
# Calculate the timeout inside the `startPipeline` controller.
calc_block = """    const jobPriority = (planPriorities as any)[finalLimitCheck.plan] || 4;

    const count = settings.videoCount || 1;
    const jobTimeoutMinutes = 10 + (count - 1) * 5;
    const jobTimeoutMs = jobTimeoutMinutes * 60 * 1000;

    // Add job to BullMQ"""

content = content.replace(
    """    const jobPriority = (planPriorities as any)[finalLimitCheck.plan] || 4;

    // Add job to BullMQ""",
    calc_block
)

queue_options = """      jobId: job._id.toString(), // Ensure idempotency
      attempts: 3,               // Retry up to 3 times on failure
      timeout: jobTimeoutMs,     // Force fail job if Azure Container App stalls
      backoff: {"""

content = re.sub(
    r'      jobId: job\._id\.toString\(\), // Ensure idempotency\n      attempts: 3,               // Retry up to 3 times on failure\n      timeout: 30 \* 60 \* 1000,   // Force fail job if Azure Container App stalls for > 30 minutes\n      backoff: \{',
    queue_options,
    content,
    flags=re.DOTALL
)

with open('backend/src/controllers/pipelineController.ts', 'w') as f:
    f.write(content)

print("Added dynamic timeout to pipeline queue")
