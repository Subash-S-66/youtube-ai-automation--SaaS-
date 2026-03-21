import re

with open('backend/src/controllers/pipelineController.ts', 'r') as f:
    content = f.read()

new_queue_options = """      jobId: job._id.toString(), // Ensure idempotency
      attempts: 3,               // Retry up to 3 times on failure
      timeout: 30 * 60 * 1000,   // Force fail job if Azure Container App stalls for > 30 minutes
      backoff: {"""

content = content.replace(
    """      jobId: job._id.toString(), // Ensure idempotency
      attempts: 3,               // Retry up to 3 times on failure
      backoff: {""",
    new_queue_options
)

with open('backend/src/controllers/pipelineController.ts', 'w') as f:
    f.write(content)

print("Added queue timeout.")
