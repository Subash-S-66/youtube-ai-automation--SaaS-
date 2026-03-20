import re

with open('backend/src/controllers/authController.ts', 'r') as f:
    content = f.read()

new_block = """        remainingUploads: limitCheck.remainingUploads,
        uploadsUsedToday: user.uploadsUsedToday || 0,
        uploadsOnHold: user.uploadsOnHold || 0,
        uploadLimitPerDay: planLimits[limitCheck.plan] || planLimits['free'] || 3,
        uploadLimit: planLimits[limitCheck.plan] || planLimits['free'] || 3,"""

content = content.replace(
    """        remainingUploads: limitCheck.remainingUploads,
        uploadsOnHold: user.uploadsOnHold || 0,
        uploadLimit: planLimits[limitCheck.plan] || planLimits['free'] || 3,""",
    new_block
)

with open('backend/src/controllers/authController.ts', 'w') as f:
    f.write(content)

print("Updated authController to expose uploadsUsedToday and uploadLimitPerDay")
