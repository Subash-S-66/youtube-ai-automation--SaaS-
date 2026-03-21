import re

with open('frontend/src/components/layout/DashboardLayout.tsx', 'r') as f:
    content = f.read()

if "import Link from 'next/link';" not in content:
    content = content.replace("import { useState } from 'react';", "import { useState } from 'react';\nimport Link from 'next/link';")

content = content.replace(
"""              return (
                <a
                  key={link.name}
                  href={link.href}""",
"""              return (
                <Link
                  key={link.name}
                  href={link.href}"""
)

content = content.replace(
"""                  {link.name}
                </a>
              )""",
"""                  {link.name}
                </Link>
              )"""
)

with open('frontend/src/components/layout/DashboardLayout.tsx', 'w') as f:
    f.write(content)

print("Updated a tags to Link tags in DashboardLayout")
