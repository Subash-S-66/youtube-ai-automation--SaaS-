import re

with open('frontend/src/components/layout/DashboardLayout.tsx', 'r') as f:
    content = f.read()

# Add warning for expiration
warning_code = """
        {/* Top Navbar */}
        <header className="sticky top-0 h-16 flex-shrink-0 bg-[#111827]/80 backdrop-blur-xl border-b border-[#1A2235] flex items-center justify-between px-4 sm:px-6 lg:px-8 z-[1000]">
           <button
             className="md:hidden text-slate-400 hover:text-white"
             onClick={() => setIsMobileMenuOpen(true)}
           >
             <Menu className="h-6 w-6" />
           </button>
           <div className="flex-1 flex justify-center ml-4 mr-4">
             {user?.subscriptionExpiresAt && (new Date(user.subscriptionExpiresAt).getTime() - new Date().getTime()) / (1000 * 3600 * 24) <= 3 && (
               <div className="bg-yellow-500/20 border border-yellow-500/50 text-yellow-400 px-4 py-1.5 rounded-lg text-xs font-bold animate-pulse flex items-center text-center">
                 ⚠️ Your {user.displayPlan || user.plan} plan expires in {Math.ceil((new Date(user.subscriptionExpiresAt).getTime() - new Date().getTime()) / (1000 * 3600 * 24))} days. Renew now to keep access.
               </div>
             )}
           </div>
           <div className="ml-auto flex items-center">
              {/* Install PWA Prompt */}
"""

content = re.sub(
    r'        \{\/\* Top Navbar \*\/\}\n        <header className="sticky top-0 h-16 flex-shrink-0 bg-\[\#111827\]/80 backdrop-blur-xl border-b border-\[\#1A2235\] flex items-center justify-between px-4 sm:px-6 lg:px-8 z-\[1000\]">\n           <button\n             className="md:hidden text-slate-400 hover:text-white"\n             onClick=\{\(\) => setIsMobileMenuOpen\(true\)\}\n           >\n             <Menu className="h-6 w-6" />\n           </button>\n           <div className="ml-auto flex items-center">\n              \{\/\* Install PWA Prompt \*\/\}',
    warning_code,
    content,
    flags=re.DOTALL
)

with open('frontend/src/components/layout/DashboardLayout.tsx', 'w') as f:
    f.write(content)

print("Added top bar renewal warning")
