import re

with open('backend/src/workers/pipelineWorker.ts', 'r') as f:
    content = f.read()

# Make sure we don't go below 0 for uploadsOnHold
new_decrement = """
      if (isCompletedState || isFinalAttempt) {
        const decrementCount = settings.videoCount || 1;

        // Safely decrement the global user uploadsOnHold (never below 0)
        await User.updateOne(
          { _id: userId, uploadsOnHold: { $gte: decrementCount } },
          { $inc: { uploadsOnHold: -decrementCount } }
        ).catch((err) => console.error(`Failed to decrement global holds for user ${userId}:`, err));

        // Safely decrement the channel specific videosOnHold
        await User.updateOne(
          { _id: userId, 'youtubeChannels.channelId': settings.channelId, 'youtubeChannels.videosOnHold': { $gte: decrementCount } },
          { $inc: { 'youtubeChannels.$.videosOnHold': -decrementCount } }
        ).catch((err) => console.error(`Failed to decrement channel holds for user ${userId}:`, err));
      } else {
"""

content = re.sub(
    r'      if \(isCompletedState \|\| isFinalAttempt\) {.*?      } else {',
    new_decrement.strip() + ' } else {',
    content,
    flags=re.DOTALL
)

with open('backend/src/workers/pipelineWorker.ts', 'w') as f:
    f.write(content)

print("Updated decrement bounds")
