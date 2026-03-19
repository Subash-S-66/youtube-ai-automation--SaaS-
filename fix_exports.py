import re

with open('frontend/src/app/dashboard/page.tsx', 'r') as f:
    content = f.read()

content = content.replace("<DashboardContent />", "<Dashboard />")
content = content.replace("function DashboardPage() {", "export default function DashboardPage() {")

with open('frontend/src/app/dashboard/page.tsx', 'w') as f:
    f.write(content)
