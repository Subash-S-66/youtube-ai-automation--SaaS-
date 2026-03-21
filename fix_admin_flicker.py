import re

with open('frontend/src/app/admin/page.tsx', 'r') as f:
    content = f.read()

# Fix the auth loading state so we don't render the DashboardLayout or any admin elements before the check.
# Find the initial useEffect that fetches user
# We need to make sure the user fetch handles setting loading correctly and redirecting.

new_use_effect = """
  useEffect(() => {
    const fetchUser = async () => {
      try {
        const userData = await authService.getMe();
        if (!userData.data || userData.data.role !== 'admin') {
          router.replace('/login');
          return;
        }
        setCurrentUser(userData.data);
        // Load initial stats and users since we are admin
        const [statsData, usersData] = await Promise.all([
          adminService.getStats(),
          adminService.getUsers()
        ]);
        setStats(statsData.data);
        setUsers(usersData.data);
      } catch (err) {
        router.replace('/login');
      } finally {
        setLoading(false);
      }
    };
    fetchUser();
  }, [router]);
"""

# Now replace the existing useEffect that handles the initial user fetch
content = re.sub(
    r'  useEffect\(\(\) => \{\n    const fetchUser = async \(\) => \{.*?    \};\n    fetchUser\(\);\n  \}, \[router\]\);',
    new_use_effect.strip(),
    content,
    flags=re.DOTALL
)

# And make sure if loading is true, we return a simple full-screen loader without the DashboardLayout wrapper
# to completely prevent the layout or sidebar from flashing before redirect
loader_block = """
  if (loading) {
    return (
      <div className="min-h-screen bg-[#0B0F1A] flex items-center justify-center">
        <RefreshCw className="h-8 w-8 text-[#7C5CFF] animate-spin" />
      </div>
    );
  }

  if (!currentUser || currentUser.role !== 'admin') {
    return null; // Prevents render while redirecting
  }
"""

content = re.sub(
    r'  if \(loading\) \{\n    return \(\n      <DashboardLayout user=\{currentUser\}>\n        <div className="flex justify-center items-center h-\[50vh\]">\n          <RefreshCw className="h-8 w-8 animate-spin text-\[\#7C5CFF\]" />\n        </div>\n      </DashboardLayout>\n    \);\n  \}',
    loader_block.strip(),
    content,
    flags=re.DOTALL
)

with open('frontend/src/app/admin/page.tsx', 'w') as f:
    f.write(content)

print("Updated admin page to prevent flicker.")
