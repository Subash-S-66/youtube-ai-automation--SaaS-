import re

with open('backend/src/controllers/youtubeController.ts', 'r') as f:
    content = f.read()

new_block = """       // Enforce Channel Limits dynamically with effective plan
       const { getUploadLimits } = require('../services/uploadLimitService');
       const limitCheck = await getUploadLimits(user.id);
       const effectivePlan = limitCheck.plan;

       const channelLimits = {
         free: 1,
         basic: 2,
         pro: 4,
         premium: 8,
       };
       const maxChannels = channelLimits[effectivePlan] || 1;

       if (user.youtubeChannels.length >= maxChannels) {"""

content = re.sub(
    r'       // Enforce Channel Limits\n       const channelLimits = {.*?if \(user\.youtubeChannels\.length >= maxChannels\) {',
    new_block,
    content,
    flags=re.DOTALL
)

with open('backend/src/controllers/youtubeController.ts', 'w') as f:
    f.write(content)

print("Updated youtube channel limits to use effective plan.")
