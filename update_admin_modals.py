import re

with open('frontend/src/app/admin/page.tsx', 'r') as f:
    content = f.read()

# Add AppModal component import if missing
if "import AppModal " not in content:
    content = content.replace("import DashboardLayout from '../../components/layout/DashboardLayout';", "import DashboardLayout from '../../components/layout/DashboardLayout';\nimport AppModal, { AppModalType } from '../../components/ui/AppModal';")

# State for modal
modal_state = """  const [updatingConfig, setUpdatingConfig] = useState(false);

  const [modalConfig, setModalConfig] = useState<{
    isOpen: boolean;
    title: string;
    description: string;
    type: AppModalType;
    onConfirm?: () => void;
    onCancel?: () => void;
    confirmText?: string;
    cancelText?: string;
  }>({
    isOpen: false,
    title: '',
    description: '',
    type: 'info',
  });"""

content = content.replace("  const [updatingConfig, setUpdatingConfig] = useState(false);", modal_state)

new_toggle = """  const executeUpdateConfig = async (newBetaMode: boolean) => {
    setUpdatingConfig(true);
    try {
      await adminService.updateSystemConfig({ betaMode: newBetaMode });
      setBetaMode(newBetaMode);
      setModalConfig({
         isOpen: true,
         title: 'Success',
         description: `Beta Mode ${newBetaMode ? 'ENABLED' : 'DISABLED'} successfully.`,
         type: 'success',
         confirmText: 'OK',
         onConfirm: () => window.location.reload()
      });
    } catch (err) {
      console.error(err);
      setModalConfig({
         isOpen: true,
         title: 'Error',
         description: 'Failed to update system config.',
         type: 'error',
         confirmText: 'Dismiss',
         onConfirm: () => setModalConfig(prev => ({...prev, isOpen: false}))
      });
    } finally {
      setUpdatingConfig(false);
    }
  };

  const handleUpdateConfig = (newBetaMode: boolean) => {
    if (newBetaMode) {
      setModalConfig({
         isOpen: true,
         title: 'Enable Beta Mode',
         description: 'Are you ABSOLUTELY sure you want to enable Beta Mode? This will instantly grant ALL users PRO privileges globally.',
         type: 'warning',
         confirmText: 'Enable globally',
         cancelText: 'Cancel',
         onConfirm: () => {
             setModalConfig(prev => ({...prev, isOpen: false}));
             executeUpdateConfig(newBetaMode);
         },
         onCancel: () => setModalConfig(prev => ({...prev, isOpen: false}))
      });
    } else {
      setModalConfig({
         isOpen: true,
         title: 'Disable Beta Mode',
         description: 'Are you sure you want to disable Beta Mode? Users will instantly revert to their normal plans.',
         type: 'warning',
         confirmText: 'Disable',
         cancelText: 'Cancel',
         onConfirm: () => {
             setModalConfig(prev => ({...prev, isOpen: false}));
             executeUpdateConfig(newBetaMode);
         },
         onCancel: () => setModalConfig(prev => ({...prev, isOpen: false}))
      });
    }
  };"""

content = re.sub(
    r'  const handleUpdateConfig = async \(newBetaMode: boolean\) => \{.*?  \};\n\n  const handleTogglePlan =',
    new_toggle + '\n\n  const handleTogglePlan =',
    content,
    flags=re.DOTALL
)

# Modal render at bottom
modal_render = """      <AppModal
        isOpen={modalConfig.isOpen}
        title={modalConfig.title}
        description={modalConfig.description}
        type={modalConfig.type}
        onConfirm={modalConfig.onConfirm}
        onCancel={modalConfig.onCancel}
        confirmText={modalConfig.confirmText}
        cancelText={modalConfig.cancelText}
      />
    </DashboardLayout>
  );"""

content = content.replace("    </DashboardLayout>\n  );", modal_render)

with open('frontend/src/app/admin/page.tsx', 'w') as f:
    f.write(content)

print("Updated admin window.confirm logic to AppModal")
