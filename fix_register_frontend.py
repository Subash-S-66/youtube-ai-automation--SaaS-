import re

with open('frontend/src/app/register/page.tsx', 'r') as f:
    content = f.read()

if "import { useSearchParams" not in content:
    content = content.replace("import { useRouter } from 'next/navigation';", "import { useRouter, useSearchParams } from 'next/navigation';")

hook_logic = """  const searchParams = useSearchParams();
  const refCode = searchParams.get('ref') || undefined;

  const handleRegister = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);
    setError('');
    setSuccess('');
    try {
      const data = await authService.register({ email, password, referralCode: refCode });
"""

content = re.sub(
    r'  const handleRegister = async \(e: React\.FormEvent\) => \{\n    e\.preventDefault\(\);\n    setIsLoading\(true\);\n    setError\(\'\'\);\n    setSuccess\(\'\'\);\n    try \{\n      const data = await authService\.register\(\{ email, password \}\);',
    hook_logic,
    content,
    flags=re.DOTALL
)

with open('frontend/src/app/register/page.tsx', 'w') as f:
    f.write(content)

print("Updated registration frontend for referrals")
