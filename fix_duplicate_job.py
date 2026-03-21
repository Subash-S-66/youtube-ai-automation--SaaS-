import re

with open('backend/src/controllers/pipelineController.ts', 'r') as f:
    content = f.read()

content = content.replace(
    '      jobId: job._id.toString(), // Ensure idempotency {\n      jobId: job._id.toString(), // Ensure idempotency',
    '      jobId: job._id.toString(), // Ensure idempotency'
)

with open('backend/src/controllers/pipelineController.ts', 'w') as f:
    f.write(content)
