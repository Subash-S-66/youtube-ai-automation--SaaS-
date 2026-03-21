import re

with open('backend/src/controllers/youtubeController.ts', 'r') as f:
    content = f.read()

new_limits = """       const channelLimits = {
         free: 1,
         basic: 3,
         pro: 10,
         premium: 50,
       };"""

content = re.sub(
    r'       const channelLimits = \{\n         free: 1,\n         basic: 2,\n         pro: 4,\n         premium: 8,\n       \};',
    new_limits,
    content,
    flags=re.DOTALL
)

with open('backend/src/controllers/youtubeController.ts', 'w') as f:
    f.write(content)

print("Updated youtubeController channel limits")
