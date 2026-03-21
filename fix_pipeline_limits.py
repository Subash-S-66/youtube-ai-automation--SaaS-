import re

with open('backend/src/controllers/pipelineController.ts', 'r') as f:
    content = f.read()

# Make sure concurrent limits check uses limitCheck.plan (effective plan) rather than user.plan directly to respect Beta mode
content = content.replace(
    'const maxConcurrentJobs = concurrentLimits[user.plan] || 1;',
    'const maxConcurrentJobs = (concurrentLimits as any)[limitCheck.plan] || 1;'
)

with open('backend/src/controllers/pipelineController.ts', 'w') as f:
    f.write(content)

print("Updated pipelineController to use effective plan for concurrent limits")
