import re

with open('frontend/src/app/dashboard/page.tsx', 'r') as f:
    content = f.read()

# Add useSearchParams
if "import { useSearchParams } from 'next/navigation';" not in content:
    content = content.replace("import { motion, AnimatePresence } from 'framer-motion';", "import { motion, AnimatePresence } from 'framer-motion';\nimport { useSearchParams, useRouter } from 'next/navigation';")

# Inside Dashboard component, check for ?payment=success and show an alert/refetch, then strip query
new_hook = """  const searchParams = useSearchParams();
  const router = useRouter();

  useEffect(() => {
    if (searchParams.get('payment') === 'success') {
      alert('Subscription upgraded successfully! Your limits have been updated.');
      router.replace('/dashboard');
    }
  }, [searchParams, router]);

  useEffect(() => {
    const fetchData = async () => {
"""

content = content.replace(
    "  useEffect(() => {\n    const fetchData = async () => {",
    new_hook
)

with open('frontend/src/app/dashboard/page.tsx', 'w') as f:
    f.write(content)

print("Updated dashboard with payment success check.")
