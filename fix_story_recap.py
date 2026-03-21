import re

with open('frontend/src/app/dashboard/page.tsx', 'r') as f:
    content = f.read()

# When we send recapEnabled, it should be explicitly false if currentPart <= 1
new_execute = """      const pipelineRes = await pipelineService.runPipeline(pId, {
        targetDuration: duration,
        contentType,
        videoCount,
        channelId: selectedChannelId,
        storyMode,
        storyId: executeStoryId || storyId,
        currentPart,
        recapEnabled: currentPart > 1 ? recapEnabled : false,
        ctaEnabled,
        voices: finalVoices"""

content = re.sub(
    r'      const pipelineRes = await pipelineService\.runPipeline\(pId, \{\n        targetDuration: duration,\n        contentType,\n        videoCount,\n        channelId: selectedChannelId,\n        storyMode,\n        storyId: executeStoryId \|\| storyId,\n        currentPart,\n        recapEnabled,\n        ctaEnabled,\n        voices: finalVoices',
    new_execute,
    content,
    flags=re.DOTALL
)

with open('frontend/src/app/dashboard/page.tsx', 'w') as f:
    f.write(content)

print("Fixed frontend recapEnabled payload")
