import re

with open('frontend/src/app/dashboard/page.tsx', 'r') as f:
    content = f.read()

# React 18 / Next.js requires useSearchParams inside a Suspense block if the page is statically generated / client-side.
# To bypass this for a simple client component, we can wrap the main component or add Suspense.
# Actually, we can just replace the default export with a wrapper that provides Suspense.

if "import { Suspense } from 'react';" not in content:
    content = content.replace("import { useEffect, useState } from 'react';", "import { useEffect, useState, Suspense } from 'react';")

# Rename existing DashboardPage to DashboardContent
content = content.replace("export default function DashboardPage() {", "function DashboardContent() {")

# Add the new default export at the bottom
wrapper = """
export default function DashboardPage() {
  return (
    <Suspense fallback={<div className="min-h-screen bg-[#0B0F1A] flex items-center justify-center"><RefreshCw className="h-8 w-8 text-[#7C5CFF] animate-spin" /></div>}>
      <DashboardContent />
    </Suspense>
  );
}
"""

content += wrapper

with open('frontend/src/app/dashboard/page.tsx', 'w') as f:
    f.write(content)

print("Wrapped dashboard with Suspense")
