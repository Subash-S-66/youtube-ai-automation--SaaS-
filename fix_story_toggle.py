import re

with open('frontend/src/app/dashboard/page.tsx', 'r') as f:
    content = f.read()

toggle_fn = """  const handleStoryModeToggle = () => {
    if (user?.plan === 'free') {
      setModalConfig({
        isOpen: true,
        title: 'Upgrade Required',
        description: 'Story Mode is only available on Basic, Pro, and Premium plans. Upgrade to unlock this feature.',
        type: 'warning',
        confirmText: 'Upgrade Now',
        cancelText: 'Dismiss',
        onConfirm: () => { router.push('/pricing'); setModalConfig(prev => ({ ...prev, isOpen: false })); },
        onCancel: () => setModalConfig(prev => ({ ...prev, isOpen: false })),
      });
      return;
    }
    setStoryMode(!storyMode);
  };
"""

# Insert function before executePipeline
content = content.replace("  const executePipeline = async (pId: string, acceptedWarning: boolean, newPromptContent?: string, executeStoryId?: string) => {", toggle_fn + "\n  const executePipeline = async (pId: string, acceptedWarning: boolean, newPromptContent?: string, executeStoryId?: string) => {")

content = content.replace(
    'onChange={() => setStoryMode(!storyMode)}',
    'onChange={handleStoryModeToggle}'
)

with open('frontend/src/app/dashboard/page.tsx', 'w') as f:
    f.write(content)

print("Updated dashboard story toggle constraint")
