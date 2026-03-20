import re

with open('backend/src/utils/validators/pipelineValidators.ts', 'r') as f:
    content = f.read()

new_schema = """      userMediaPaths: z.array(z.string()).optional(),
      lastPrompt: z.string().optional(),
      templateConfig: z.object({
         fontStyle: z.string().optional(),
         subtitleColor: z.string().optional()
      }).optional()
    }, {"""

content = content.replace("      userMediaPaths: z.array(z.string()).optional(),\n      lastPrompt: z.string().optional(),\n    }, {", new_schema)

with open('backend/src/utils/validators/pipelineValidators.ts', 'w') as f:
    f.write(content)

with open('backend/src/controllers/pipelineController.ts', 'r') as f:
    controller = f.read()

premium_check = """
    if (limitCheck.plan !== 'premium' && settings.templateConfig) {
        throw new AppError('Template Customization is only available on the Premium plan.', 403);
    }
"""

controller = controller.replace("        if ((settings as any).scheduledAt || (settings as any).scheduleEnabled) {\n            throw new AppError('Scheduling is not available on the Free plan. Please upgrade to Basic or higher.', 403);\n        }\n    }", "        if ((settings as any).scheduledAt || (settings as any).scheduleEnabled) {\n            throw new AppError('Scheduling is not available on the Free plan. Please upgrade to Basic or higher.', 403);\n        }\n    }\n" + premium_check)

with open('backend/src/controllers/pipelineController.ts', 'w') as f:
    f.write(controller)

print("Updated backend for premium template customization")
