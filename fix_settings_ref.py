import re

with open('frontend/src/app/settings/page.tsx', 'r') as f:
    content = f.read()

if "import { Copy } from 'lucide-react';" not in content:
    content = content.replace("import { Settings, Youtube, Mail, BellRing, Trash2, ShieldAlert, CheckCircle2, RefreshCw, User, Info, Save } from 'lucide-react';", "import { Settings, Youtube, Mail, BellRing, Trash2, ShieldAlert, CheckCircle2, RefreshCw, User, Info, Save, Copy } from 'lucide-react';")

ref_block = """
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">

        {/* Left Column: Overview & Referrals */}
        <div className="space-y-6">
          <div className="bg-[#111827] border border-[#1A2235] p-6 rounded-2xl shadow-xl relative overflow-hidden">
            <div className="absolute top-0 left-0 w-full h-[1px] bg-gradient-to-r from-[#0B0F1A] via-[#7C5CFF] to-[#0B0F1A] opacity-50"></div>
            <div className="flex items-center mb-6">
              <User className="h-5 w-5 text-slate-300 mr-3" />
              <h2 className="text-xl font-bold text-white">Account Info</h2>
            </div>
            <div className="space-y-4">
              <div>
                <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-1">Email</p>
                <p className="text-slate-300 font-medium">{user?.user?.email}</p>
              </div>
              <div>
                <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-1">Role</p>
                <p className="text-[#00D4FF] font-medium capitalize">{user?.user?.role}</p>
              </div>
              <div>
                <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-1">Plan</p>
                <p className="text-[#FF4FD8] font-bold capitalize">{user?.displayPlan || user?.plan}</p>
              </div>
            </div>
          </div>

          <div className="bg-[#111827] border border-[#1A2235] p-6 rounded-2xl shadow-xl relative overflow-hidden">
            <div className="absolute top-0 left-0 w-full h-[1px] bg-gradient-primary opacity-50"></div>
            <div className="flex items-center mb-4">
              <h2 className="text-xl font-bold text-white">Refer a Friend</h2>
            </div>
            <p className="text-sm text-slate-400 mb-4">Share this link to invite users. If they subscribe, you instantly get 7 days of upgraded access added to your plan!</p>
            <div className="p-3 bg-[#0B0F1A] rounded-xl border border-[#1A2235] flex items-center justify-between">
               <span className="text-xs text-[#00D4FF] font-mono truncate mr-3">{typeof window !== 'undefined' ? `${window.location.origin}/register?ref=${user?.user?.referralCode}` : ''}</span>
               <button onClick={() => { navigator.clipboard.writeText(`${window.location.origin}/register?ref=${user?.user?.referralCode}`); setMessage({ text: 'Copied referral link!', type: 'success' }) }} className="p-2 hover:bg-[#1A2235] text-slate-400 hover:text-white rounded-lg transition-colors">
                  <Copy className="h-4 w-4" />
               </button>
            </div>
          </div>
        </div>

        {/* Right Column */}
        <div className="lg:col-span-2 space-y-6">
"""

content = re.sub(
    r'      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">\n\n        \{\/\* Left Column \*\/.*?<div className="lg:col-span-2 space-y-6">',
    ref_block,
    content,
    flags=re.DOTALL
)

with open('frontend/src/app/settings/page.tsx', 'w') as f:
    f.write(content)

print("Added referral section to settings page")
