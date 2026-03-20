import re

with open('backend/src/controllers/authController.ts', 'r') as f:
    content = f.read()

new_block = """        user: {
          _id: user.id,
          email: user.email,
          role: user.role,
          isYoutubeConnected: user.isYoutubeConnected,
          emailNotificationsEnabled: user.emailNotificationsEnabled,
          telegramNotificationsEnabled: user.telegramNotificationsEnabled,
          pushNotificationsEnabled: user.pushNotificationsEnabled,
          subscriptionExpiresAt: user.subscriptionExpiresAt,
          referralCode: user.referralCode,
          cancelAtPeriodEnd: user.cancelAtPeriodEnd,
        },"""

content = content.replace(
"""        user: {
          _id: user.id,
          email: user.email,
          role: user.role,
          isYoutubeConnected: user.isYoutubeConnected,
          emailNotificationsEnabled: user.emailNotificationsEnabled,
          telegramNotificationsEnabled: user.telegramNotificationsEnabled,
          pushNotificationsEnabled: user.pushNotificationsEnabled,
          subscriptionExpiresAt: user.subscriptionExpiresAt,
        },""", new_block
)

with open('backend/src/controllers/authController.ts', 'w') as f:
    f.write(content)

print("Updated getMe logic")
