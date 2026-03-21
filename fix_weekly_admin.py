import re

with open('backend/src/controllers/adminController.ts', 'r') as f:
    content = f.read()

weekly_job = """
export const triggerWeeklyReports = asyncHandler(async (req: Request, res: Response) => {
  const oneWeekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

  const activeUsers = await User.find({
    plan: { $in: ['basic', 'pro', 'premium'] }
  }).select('email _id');

  let emailsQueued = 0;

  for (const user of activeUsers) {
    const weeklyJobs = await Job.countDocuments({
      userId: user._id,
      status: 'success',
      createdAt: { $gte: oneWeekAgo }
    });

    if (weeklyJobs > 0) {
      await emailQueue.add('emailJob', {
        to: user.email,
        subject: 'Your Weekly ClipForge Analytics',
        message: `Hello!\n\nYou successfully generated and uploaded ${weeklyJobs} videos over the past 7 days. Keep up the great work and watch your channels grow!\n\n- The ClipForge Team`
      });
      emailsQueued++;
    }
  }

  res.status(200).json({
    success: true,
    message: `Weekly report triggered successfully. Queued ${emailsQueued} emails.`,
  });
});
"""

content += weekly_job

with open('backend/src/controllers/adminController.ts', 'w') as f:
    f.write(content)

with open('backend/src/routes/adminRoutes.ts', 'r') as f:
    content_routes = f.read()

content_routes = content_routes.replace("  updateSystemConfig,\n}", "  updateSystemConfig,\n  triggerWeeklyReports,\n}")
content_routes = content_routes.replace("router.post('/config', updateSystemConfig);", "router.post('/config', updateSystemConfig);\nrouter.post('/trigger-reports', triggerWeeklyReports);")

with open('backend/src/routes/adminRoutes.ts', 'w') as f:
    f.write(content_routes)

print("Added weekly analytics trigger")
