import re

with open('backend/src/workers/pipelineWorker.ts', 'r') as f:
    content = f.read()

new_block = """      // 2b. Safely compute Story Mode state exactly before passing to container
      if (settings.storyMode && settings.storyId) {
        const progress = await StoryProgress.findOne({ userId, storyId: settings.storyId });
        if (progress) {
          settings.currentPart = progress.currentPart;
          settings.lastPrompt = progress.lastPrompt;
        } else {
          settings.currentPart = 1;
          settings.lastPrompt = "";
        }

        // Ensure recap is strictly disabled for Part 1 regardless of frontend payload
        if (settings.currentPart <= 1) {
            settings.recapEnabled = false;
        }

        await appendLogSafe(jobId, `\\nProceeding with Story ${settings.storyId} - Episode ${settings.currentPart}...\\n`, 'running');
      }"""

content = re.sub(
    r'      // 2b\. Safely compute Story Mode state exactly before passing to container\n      if \(settings\.storyMode && settings\.storyId\) \{.*?await appendLogSafe\(jobId, `\\nProceeding with Story \$\{settings\.storyId\} - Episode \$\{settings\.currentPart\}\.\.\.\\n`, \'running\'\);\n      \}',
    new_block,
    content,
    flags=re.DOTALL
)

with open('backend/src/workers/pipelineWorker.ts', 'w') as f:
    f.write(content)

print("Added strict backend recap logic check for part 1")
