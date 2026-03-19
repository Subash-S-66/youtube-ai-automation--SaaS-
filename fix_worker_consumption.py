import re

with open('backend/src/workers/pipelineWorker.ts', 'r') as f:
    content = f.read()

# Rule: YOUTUBE_REJECTED consumes the upload ONLY IF the job's acceptedYouTubeLimitWarning is true.
new_block = """         } else if (finalStatusMarker === 'YOUTUBE_REJECTED') {
            await JobModel.findByIdAndUpdate(jobId, { status: 'failed' });

            const dbJobCheck = await JobModel.findById(jobId);
            const acceptedWarning = dbJobCheck?.acceptedYouTubeLimitWarning || false;

            if (acceptedWarning) {
              await incrementUploadCount(userId, settings.videoCount || 1).catch(console.error);
            }

            if (user) {
              await notifyUser(user, 'Video Upload Failed', '❌ Video upload failed due to YouTube limits.').catch(console.error);
            }
         } else {"""

content = re.sub(
    r'} else if \(finalStatusMarker === \'YOUTUBE_REJECTED\'\) {.*?} else {',
    new_block,
    content,
    flags=re.DOTALL
)

with open('backend/src/workers/pipelineWorker.ts', 'w') as f:
    f.write(content)

print("Updated pipeline worker consumption rules.")
