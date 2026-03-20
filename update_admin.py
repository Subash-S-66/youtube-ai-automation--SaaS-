import re

with open('frontend/src/app/admin/page.tsx', 'r') as f:
    content = f.read()

new_block = """      await adminService.updateSystemConfig({ betaMode: newBetaMode });
      setBetaMode(newBetaMode);
      alert(`Beta Mode ${newBetaMode ? 'ENABLED' : 'DISABLED'} successfully.`);
      window.location.reload(); // Force refresh to update all limits/user context instantly
    } catch (err) {"""

content = re.sub(
    r'await adminService\.updateSystemConfig.*?catch \(err\) {',
    new_block,
    content,
    flags=re.DOTALL
)

with open('frontend/src/app/admin/page.tsx', 'w') as f:
    f.write(content)

print("Updated admin page to reload after beta toggle.")
