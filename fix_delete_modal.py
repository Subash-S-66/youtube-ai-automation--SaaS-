import re

with open('frontend/src/app/admin/page.tsx', 'r') as f:
    content = f.read()

delete_logic = """
  const handleDeleteUser = () => {
    if (!selectedUserId) return;

    setModalConfig({
       isOpen: true,
       title: 'Delete User',
       description: 'Are you absolutely sure you want to delete this user? This action cannot be undone.',
       type: 'critical',
       confirmText: 'Delete Permanently',
       cancelText: 'Cancel',
       onConfirm: async () => {
           setModalConfig(prev => ({...prev, isOpen: false}));
           try {
             await adminService.deleteUser(selectedUserId);
             setModalConfig({
                isOpen: true,
                title: 'Success',
                description: 'User deleted successfully.',
                type: 'success',
                confirmText: 'OK',
                onConfirm: () => setModalConfig(prev => ({...prev, isOpen: false}))
             });
             setSelectedUserId(null);
             const usersData = await adminService.getUsers();
             setUsers(usersData.data);
           } catch (err) {
             console.error(err);
             setModalConfig({
                isOpen: true,
                title: 'Error',
                description: 'Failed to delete user.',
                type: 'error',
                confirmText: 'Dismiss',
                onConfirm: () => setModalConfig(prev => ({...prev, isOpen: false}))
             });
           }
       },
       onCancel: () => setModalConfig(prev => ({...prev, isOpen: false}))
    });
  };
"""

content = re.sub(
    r'  const handleDeleteUser = async \(\) => \{.*?  \};',
    delete_logic.strip(),
    content,
    flags=re.DOTALL
)

with open('frontend/src/app/admin/page.tsx', 'w') as f:
    f.write(content)

print("Updated delete user to use modal")
