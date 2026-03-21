import re

with open('frontend/src/app/register/page.tsx', 'r') as f:
    content = f.read()

if "import { Suspense } from 'react';" not in content:
    content = content.replace("import { useState } from 'react';", "import { useState, Suspense } from 'react';")

content = content.replace("export default function Register() {", "function RegisterContent() {")

wrapper = """
export default function Register() {
  return (
    <Suspense fallback={<div className="min-h-screen bg-[#0B0F1A] flex items-center justify-center"><div className="w-8 h-8 rounded-full border-2 border-[#7C5CFF] border-t-transparent animate-spin"></div></div>}>
      <RegisterContent />
    </Suspense>
  );
}
"""

content += wrapper

with open('frontend/src/app/register/page.tsx', 'w') as f:
    f.write(content)

print("Wrapped register with Suspense")
