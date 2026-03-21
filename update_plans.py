import re

with open('backend/src/config/plans.ts', 'r') as f:
    content = f.read()

content = content.replace("free: 3,", "free: 2,")

with open('backend/src/config/plans.ts', 'w') as f:
    f.write(content)
print("Updated plans.ts")
