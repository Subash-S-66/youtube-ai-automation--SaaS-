import re

with open('backend/src/controllers/pipelineController.ts', 'r') as f:
    content = f.read()

new_block = """const planPriorities: Record<string, number> = {
      premium: 1,
      pro: 2,
      basic: 3,
      free: 4,
    };
    const jobPriority = planPriorities[finalLimitCheck.plan] || 4;

    const count = settings.videoCount || 1;
    const jobTimeoutMinutes = 10 + (count - 1) * 5;
    const jobTimeoutMs = jobTimeoutMinutes * 60 * 1000;

    // Add job to BullMQ"""

content = re.sub(
    r'const planPriorities: Record<string, number> = \{\n      premium: 1,\n      pro: 2,\n      basic: 3,\n      free: 4,\n    \};\n    const jobPriority = planPriorities\[finalLimitCheck\.plan\] \|\| 4;\n\n    // Add job to BullMQ',
    new_block,
    content,
    flags=re.DOTALL
)

with open('backend/src/controllers/pipelineController.ts', 'w') as f:
    f.write(content)

print("Injected timeout calc.")
