import re

with open('frontend/src/app/admin/page.tsx', 'r') as f:
    content = f.read()

# Make sure we use layout that doesn't leak UI elements when loading
new_use_effect = """  useEffect(() => {
    let isMounted = true;
    const initAdmin = async () => {
      try {
        const me = await authService.getMe();
        if (!me?.data?.user || me.data.user.role !== 'admin') {
          if (isMounted) router.replace('/dashboard');
          return;
        }

        if (isMounted) {
          setCurrentUser({ ...me.data.user, plan: me.data.plan, displayPlan: me.data.displayPlan, isBetaMode: me.data.isBetaMode });
          const [statsData, usersData] = await Promise.all([
            adminService.getStats(),
            adminService.getUsers()
          ]);
          setStats(statsData.data);
          setUsers(usersData.data);
        }
      } catch (error) {
        console.error("Admin init error", error);
        if (isMounted) router.replace('/login');
      } finally {
        if (isMounted) setLoading(false);
      }
    };
    initAdmin();
    return () => { isMounted = false; };
  }, [router]);"""

content = re.sub(
    r'  useEffect\(\(\) => \{\n    const initAdmin = async \(\) => \{.*?\n    initAdmin\(\);\n  \}, \[router\]\);',
    new_use_effect,
    content,
    flags=re.DOTALL
)

with open('frontend/src/app/admin/page.tsx', 'w') as f:
    f.write(content)

print("Updated initAdmin hook logic in admin page")
