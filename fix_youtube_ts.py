import re

with open('backend/src/controllers/youtubeController.ts', 'r') as f:
    content = f.read()

content = content.replace(
    'const maxChannels = channelLimits[effectivePlan] || 1;',
    'const maxChannels = (channelLimits as any)[effectivePlan] || 1;'
)

with open('backend/src/controllers/youtubeController.ts', 'w') as f:
    f.write(content)

print("Fixed typescript error in youtubeController.ts")
