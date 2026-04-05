'use client';

import { useEffect, useState, useRef, RefObject } from 'react';
import { Users, Search, RefreshCw, ChevronLeft, Save, History as HistoryIcon, FileText, Trash2 } from 'lucide-react';
import { adminService } from '../../../services/adminService';
import { cn } from '../../../lib/utils';
import AppModal, { AppModalType } from '../../../components/ui/AppModal';

interface UserSummary {
  _id: string;
  email: string;
  role: string;
  plan: string;
  uploadsUsedToday: number;
  uploadsOnHold: number;
  subscriptionExpiresAt?: string;
}


interface UserDetails {
  user: any;
  jobs: any[];
  prompts: any[];
}

export default function AdminUsersPage() {
  const [dashboardLoading, setDashboardLoading] = useState(false);
  const [users, setUsers] = useState<UserSummary[]>([]);
  const [userPage, setUserPage] = useState(1);
  const [userTotalPages, setUserTotalPages] = useState(1);
  const [userSearch, setUserSearch] = useState('');
  const [createAdminEmail, setCreateAdminEmail] = useState('');
  const [createAdminPassword, setCreateAdminPassword] = useState('');
  const [createStaffRole, setCreateStaffRole] = useState<'admin' | 'helper'>('admin');
  const [creatingAdmin, setCreatingAdmin] = useState(false);
  const [selectedUserId, setSelectedUserId] = useState<string | null>(null);
  const [userDetails, setUserDetails] = useState<UserDetails | null>(null);
  const [editPlan, setEditPlan] = useState('free');
  const [editExpiry, setEditExpiry] = useState('');
  const [savingPlan, setSavingPlan] = useState(false);
  const editExpiryRef = useRef<HTMLInputElement | null>(null);
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
  });

  useEffect(() => {
    let isMounted = true;
    const initAdmin = async () => {
      try {
        if (!isMounted) return;
        setDashboardLoading(true);
        const usersRes = await adminService.getUsers(userPage, 10, userSearch);
        if (isMounted && usersRes?.success) {
          setUsers(usersRes.data);
          setUserTotalPages(usersRes.pagination?.pages || 1);
        }
        setDashboardLoading(false);
      } catch (error) {
        console.error('Admin users init error', error);
      } finally {
        if (isMounted) {
          setDashboardLoading(false);
        }
      }
    };
    initAdmin();
    return () => { isMounted = false; };
  }, [userPage, userSearch]);

  const openPicker = (ref: RefObject<HTMLInputElement | null>) => {
    const el = ref.current;
    if (!el) return;
    if (typeof (el as any).showPicker === 'function') {
      (el as any).showPicker();
    } else {
      el.focus();
    }
  };

  const handleUserSearchChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setUserSearch(e.target.value);
    setUserPage(1);
  };

  const loadUserDetails = async (id: string) => {
    try {
      setSelectedUserId(id);
      setUserDetails(null);
      const data = await adminService.getUserDetails(id);
      setUserDetails(data.data);
      setEditPlan(data.data.user.plan);
      if (data.data.user.subscriptionExpiresAt) {
        setEditExpiry(new Date(data.data.user.subscriptionExpiresAt).toISOString().split('T')[0]);
      } else {
        setEditExpiry('');
      }
    } catch (error) {
      console.error(error);
    }
  };

  const handleUpdatePlan = async () => {
    if (!selectedUserId) return;
    setSavingPlan(true);
    try {
      await adminService.updateUserPlan(selectedUserId, {
        plan: editPlan,
        subscriptionExpiresAt: editExpiry ? new Date(editExpiry).toISOString() : null,
      });
      await loadUserDetails(selectedUserId);
      setModalConfig({
        isOpen: true,
        title: 'Success',
        description: 'Plan updated successfully.',
        type: 'success',
        confirmText: 'OK',
        onConfirm: () => setModalConfig(prev => ({ ...prev, isOpen: false })),
      });
    } catch (err: any) {
      setModalConfig({
        isOpen: true,
        title: 'Error',
        description: err.response?.data?.message || 'Failed to update plan.',
        type: 'error',
        confirmText: 'Dismiss',
        onConfirm: () => setModalConfig(prev => ({ ...prev, isOpen: false })),
      });
    } finally {
      setSavingPlan(false);
    }
  };

  const handleDeleteUser = () => {
    if (!selectedUserId) return;
    setModalConfig({
      isOpen: true,
      title: 'Delete User',
      description: 'Are you absolutely sure you want to delete this user? This action cannot be undone.',
      type: 'error',
      confirmText: 'Delete Permanently',
      cancelText: 'Cancel',
      onConfirm: async () => {
        setModalConfig(prev => ({ ...prev, isOpen: false }));
        try {
          await adminService.deleteUser(selectedUserId);
          setSelectedUserId(null);
          const usersData = await adminService.getUsers(userPage, 10, userSearch);
          setUsers(usersData.data);
          setModalConfig({
            isOpen: true,
            title: 'Success',
            description: 'User deleted successfully.',
            type: 'success',
            confirmText: 'OK',
            onConfirm: () => setModalConfig(prev => ({ ...prev, isOpen: false })),
          });
        } catch (err) {
          setModalConfig({
            isOpen: true,
            title: 'Error',
            description: 'Failed to delete user.',
            type: 'error',
            confirmText: 'Dismiss',
            onConfirm: () => setModalConfig(prev => ({ ...prev, isOpen: false })),
          });
        }
      },
      onCancel: () => setModalConfig(prev => ({ ...prev, isOpen: false })),
    });
  };

  const handleCreateAdmin = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!createAdminEmail.trim() || !createAdminPassword.trim()) {
      return;
    }

    setCreatingAdmin(true);
    try {
      await adminService.createAdminUser({
        email: createAdminEmail.trim(),
        password: createAdminPassword,
        role: createStaffRole,
      });

      setCreateAdminEmail('');
      setCreateAdminPassword('');

      const usersRes = await adminService.getUsers(userPage, 10, userSearch);
      if (usersRes?.success) {
        setUsers(usersRes.data);
        setUserTotalPages(usersRes.pagination?.pages || 1);
      }

      setModalConfig({
        isOpen: true,
        title: `${createStaffRole === 'helper' ? 'Helper' : 'Admin'} Created`,
        description: `New ${createStaffRole} account was created successfully.`,
        type: 'success',
        confirmText: 'OK',
        onConfirm: () => setModalConfig(prev => ({ ...prev, isOpen: false })),
      });
    } catch (err: any) {
      setModalConfig({
        isOpen: true,
        title: `Create ${createStaffRole === 'helper' ? 'Helper' : 'Admin'} Failed`,
        description: err.response?.data?.message || `Unable to create ${createStaffRole} user.`,
        type: 'error',
        confirmText: 'Dismiss',
        onConfirm: () => setModalConfig(prev => ({ ...prev, isOpen: false })),
      });
    } finally {
      setCreatingAdmin(false);
    }
  };

  return (
    <>
      <div className="max-w-7xl mx-auto py-8">
        {!selectedUserId ? (
          <div className="space-y-6">
            <h1 className="text-3xl font-extrabold text-transparent bg-clip-text bg-gradient-to-r from-white to-slate-400">Users Directory</h1>

            <div className="bg-[#111827] border border-[#1A2235] rounded-2xl shadow-xl p-6">
              <div className="mb-4">
                <h2 className="text-lg font-bold text-white">Create Staff User</h2>
                <p className="text-xs text-slate-400 mt-1">Create admin or helper logins securely from the dashboard.</p>
              </div>
              <form onSubmit={handleCreateAdmin} className="grid grid-cols-1 md:grid-cols-4 gap-3">
                <input
                  type="email"
                  value={createAdminEmail}
                  onChange={(e) => setCreateAdminEmail(e.target.value)}
                  placeholder="admin@example.com"
                  className="bg-[#0B0F1A] border border-[#1A2235] rounded-xl px-3 py-2 text-sm text-slate-200 focus:outline-none focus:border-[#7C5CFF]"
                  required
                />
                <input
                  type="password"
                  value={createAdminPassword}
                  onChange={(e) => setCreateAdminPassword(e.target.value)}
                  placeholder="Password (min 8 chars, letter + number)"
                  className="bg-[#0B0F1A] border border-[#1A2235] rounded-xl px-3 py-2 text-sm text-slate-200 focus:outline-none focus:border-[#7C5CFF]"
                  minLength={8}
                  required
                />
                <select
                  value={createStaffRole}
                  onChange={(e) => setCreateStaffRole(e.target.value as 'admin' | 'helper')}
                  className="bg-[#0B0F1A] border border-[#1A2235] rounded-xl px-3 py-2 text-sm text-slate-200 focus:outline-none focus:border-[#7C5CFF]"
                >
                  <option value="admin">Admin</option>
                  <option value="helper">Helper (tickets reply only)</option>
                </select>
                <button
                  type="submit"
                  disabled={creatingAdmin}
                  className="rounded-xl bg-[#7C5CFF] hover:bg-[#6b4fe0] disabled:opacity-60 disabled:cursor-not-allowed text-white font-bold text-sm px-4 py-2 flex items-center justify-center"
                >
                  {creatingAdmin ? <RefreshCw className="h-4 w-4 animate-spin" /> : `Create ${createStaffRole === 'helper' ? 'Helper' : 'Admin'}`}
                </button>
              </form>
            </div>

            <div className="bg-[#111827] border border-[#1A2235] rounded-2xl shadow-xl overflow-hidden">
              <div className="p-6 border-b border-[#1A2235] flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
                <div className="flex items-center">
                  <Users className="h-5 w-5 text-[#00D4FF] mr-2" />
                  <h2 className="text-xl font-bold text-white">All Users</h2>
                </div>
                <div className="relative w-full sm:w-64">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
                  <input
                    type="text"
                    placeholder="Search users..."
                    value={userSearch}
                    onChange={handleUserSearchChange}
                    className="w-full bg-[#0B0F1A] border border-[#1A2235] rounded-xl pl-9 pr-4 py-2 text-sm text-slate-200 focus:outline-none focus:border-[#7C5CFF] transition-colors"
                  />
                </div>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse">
                  <thead>
                    <tr className="bg-[#0B0F1A] text-slate-400 text-xs uppercase tracking-wider">
                      <th className="p-4 font-medium">Email</th>
                      <th className="p-4 font-medium">Role</th>
                      <th className="p-4 font-medium">Plan</th>
                      <th className="p-4 font-medium hidden sm:table-cell">Usage (Today)</th>
                      <th className="p-4 font-medium hidden sm:table-cell">On Hold</th>
                      <th className="p-4 font-medium hidden md:table-cell">Expiry</th>
                    </tr>
                  </thead>
                  <tbody className="text-sm divide-y divide-[#1A2235]">
                    {users.map(u => (
                      <tr key={u._id} onClick={() => loadUserDetails(u._id)} className="hover:bg-[#1A2235]/50 cursor-pointer transition-colors group">
                        <td className="p-4 font-medium text-slate-200 group-hover:text-white transition-colors">{u.email}</td>
                        <td className="p-4">
                          <span className={cn(
                            'px-2.5 py-1 text-xs font-bold rounded-lg border',
                            u.role === 'admin'
                              ? 'bg-emerald-500/10 text-emerald-300 border-emerald-500/30'
                              : u.role === 'helper'
                              ? 'bg-cyan-500/10 text-cyan-300 border-cyan-500/30'
                              : 'bg-slate-500/10 text-slate-300 border-slate-500/20'
                          )}>
                            {String(u.role || 'user').toUpperCase()}
                          </span>
                        </td>
                        <td className="p-4">
                          <span className={cn("px-2.5 py-1 text-xs font-bold rounded-lg border", u.plan === 'free' ? "bg-slate-500/10 text-slate-300 border-slate-500/20" : "bg-[#7C5CFF]/10 text-[#7C5CFF] border-[#7C5CFF]/20")}>{u.plan.toUpperCase()}</span>
                        </td>
                        <td className="p-4 text-slate-400 hidden sm:table-cell">{u.uploadsUsedToday}</td>
                        <td className="p-4 text-slate-400 hidden sm:table-cell">{u.uploadsOnHold}</td>
                        <td className="p-4 text-slate-400 hidden md:table-cell">{u.subscriptionExpiresAt ? new Date(u.subscriptionExpiresAt).toLocaleDateString() : 'N/A'}</td>
                      </tr>
                    ))}
                    {dashboardLoading && (
                      <tr><td colSpan={6} className="p-8 text-center text-slate-500">Loading users...</td></tr>
                    )}
                    {!dashboardLoading && users.length === 0 && (
                      <tr><td colSpan={6} className="p-8 text-center text-slate-500">No users found.</td></tr>
                    )}
                  </tbody>
                </table>
              </div>

              {!dashboardLoading && userTotalPages > 1 && (
                <div className="p-4 border-t border-[#1A2235] flex items-center justify-between bg-[#0B0F1A]">
                  <button
                    onClick={() => setUserPage(p => Math.max(1, p - 1))}
                    disabled={userPage === 1}
                    className="px-4 py-2 bg-[#1A2235] text-slate-300 rounded-lg text-sm disabled:opacity-50 hover:bg-[#2a3550] transition-colors"
                  >
                    Previous
                  </button>
                  <span className="text-sm text-slate-400">
                    Page {userPage} of {userTotalPages}
                  </span>
                  <button
                    onClick={() => setUserPage(p => Math.min(userTotalPages, p + 1))}
                    disabled={userPage === userTotalPages}
                    className="px-4 py-2 bg-[#1A2235] text-slate-300 rounded-lg text-sm disabled:opacity-50 hover:bg-[#2a3550] transition-colors"
                  >
                    Next
                  </button>
                </div>
              )}
            </div>
          </div>
        ) : (
          <div className="space-y-6">
            <button onClick={() => setSelectedUserId(null)} className="flex items-center text-slate-400 hover:text-white transition-colors text-sm font-medium">
              <ChevronLeft className="h-4 w-4 mr-1" /> Back to Directory
            </button>

            {!userDetails ? (
              <div className="p-12 flex justify-center"><RefreshCw className="h-6 w-6 animate-spin text-slate-500" /></div>
            ) : (
              <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">

                {/* Control Panel */}
                <div className="lg:col-span-1 space-y-6">
                  <div className="bg-[#111827] border border-[#1A2235] p-6 rounded-2xl shadow-xl">
                    <h3 className="text-lg font-bold text-white mb-6">User Management</h3>
                    <div className="space-y-4">
                      <div>
                        <label className="block text-xs text-slate-400 uppercase tracking-wider mb-1">Email</label>
                        <div className="text-white bg-[#0B0F1A] px-3 py-2 rounded-lg border border-[#1A2235]">{userDetails.user.email}</div>
                      </div>
                      <div>
                        <label className="block text-xs text-slate-400 uppercase tracking-wider mb-1">Plan</label>
                        <select id="edit-plan-select" aria-label="Select Plan" value={editPlan} onChange={(e) => setEditPlan(e.target.value)} className="w-full bg-[#0B0F1A] text-white px-3 py-2 rounded-lg border border-[#1A2235] focus:border-[#7C5CFF] focus:outline-none">
                          <option value="free">Free</option>
                          <option value="basic">Basic</option>
                          <option value="pro">Pro</option>
                          <option value="premium">Premium</option>
                        </select>
                      </div>
                      <div>
                        <label className="block text-xs text-slate-400 uppercase tracking-wider mb-1">Expiry Date</label>
                        <div className="relative">
                          <input
                            id="edit-expiry-date"
                            aria-label="Edit Expiry Date"
                            ref={editExpiryRef}
                            type="date"
                            value={editExpiry}
                            onChange={(e) => setEditExpiry(e.target.value)}
                            className="calendar-white w-full bg-[#0B0F1A] text-white px-3 py-2 pr-10 rounded-lg border border-[#1A2235] focus:border-[#7C5CFF] focus:outline-none [color-scheme:dark]"
                          />
                          <button
                            type="button"
                            aria-label="Open expiry date picker"
                            onClick={() => openPicker(editExpiryRef)}
                            className="absolute right-1 top-1/2 -translate-y-1/2 text-white w-9 h-9 flex items-center justify-center rounded-md hover:bg-white/10"
                          >
                            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                              <rect x="3" y="4" width="18" height="18" rx="2" ry="2" />
                              <line x1="16" y1="2" x2="16" y2="6" />
                              <line x1="8" y1="2" x2="8" y2="6" />
                              <line x1="3" y1="10" x2="21" y2="10" />
                            </svg>
                          </button>
                        </div>
                      </div>
                      <button onClick={handleUpdatePlan} disabled={savingPlan} className="w-full flex justify-center items-center py-2.5 bg-[#7C5CFF] hover:bg-[#6b4fe0] text-white font-bold rounded-lg transition-colors">
                        {savingPlan ? <RefreshCw className="h-4 w-4 animate-spin" /> : <><Save className="h-4 w-4 mr-2" /> Save Changes</>}
                      </button>
                    </div>
                  </div>

                  <div className="bg-[#111827] border border-[#1A2235] p-6 rounded-2xl shadow-xl">
                     <h3 className="text-sm font-bold text-slate-400 uppercase tracking-wider mb-4">Current Usage</h3>
                     <div className="space-y-2 text-sm text-slate-300">
                        <div className="flex justify-between"><span>Used Today:</span> <span className="text-white font-medium">{userDetails.user.uploadsUsedToday}</span></div>
                        <div className="flex justify-between"><span>On Hold:</span> <span className="text-white font-medium">{userDetails.user.uploadsOnHold}</span></div>
                        <div className="flex justify-between"><span>Verified:</span> <span className={userDetails.user.isEmailVerified ? 'text-green-400' : 'text-red-400'}>{userDetails.user.isEmailVerified ? 'Yes' : 'No'}</span></div>
                        <div className="flex justify-between"><span>YouTube:</span> <span className={userDetails.user.isYoutubeConnected ? 'text-[#00D4FF]' : 'text-slate-500'}>{userDetails.user.isYoutubeConnected ? 'Connected' : 'Disconnected'}</span></div>
                     </div>
                  </div>

                  <div className="pt-4">
                    <button onClick={handleDeleteUser} className="w-full flex justify-center items-center py-2.5 bg-red-500/10 hover:bg-red-500/20 text-red-500 border border-red-500/20 font-bold rounded-lg transition-colors">
                      <Trash2 className="h-4 w-4 mr-2" /> Delete Account
                    </button>
                  </div>
                </div>

                {/* History & Logs */}
                <div className="lg:col-span-2 space-y-6">
                  <div className="bg-[#111827] border border-[#1A2235] rounded-2xl shadow-xl overflow-hidden flex flex-col max-h-[400px]">
                     <div className="p-4 border-b border-[#1A2235] bg-[#0B0F1A] flex items-center">
                       <HistoryIcon className="h-5 w-5 mr-2 text-[#7C5CFF]" />
                       <h3 className="text-md font-bold text-white">Upload History (Jobs)</h3>
                     </div>
                     <div className="overflow-y-auto flex-1 p-4 space-y-3">
                       {userDetails.jobs.length === 0 ? <p className="text-slate-500 text-sm">No jobs found.</p> : userDetails.jobs.map(job => (
                         <div key={job._id} className="p-3 bg-[#0B0F1A] border border-[#1A2235] rounded-xl flex justify-between items-start">
                           <div>
                             <p className="text-xs text-slate-400 mb-1">{new Date(job.createdAt).toLocaleString()}</p>
                             <span className={cn("text-[10px] uppercase px-2 py-0.5 rounded font-bold tracking-wider", job.status === 'success' ? 'bg-green-500/10 text-green-400' : job.status === 'failed' ? 'bg-red-500/10 text-red-400' : job.status === 'running' ? 'bg-[#00D4FF]/10 text-[#00D4FF]' : 'bg-slate-500/10 text-slate-400')}>{job.status}</span>
                           </div>
                           <div className="text-xs text-slate-500 max-w-[200px] truncate" title={job._id}>ID: {job._id}</div>
                         </div>
                       ))}
                     </div>
                  </div>

                  <div className="bg-[#111827] border border-[#1A2235] rounded-2xl shadow-xl overflow-hidden flex flex-col max-h-[400px]">
                     <div className="p-4 border-b border-[#1A2235] bg-[#0B0F1A] flex items-center">
                       <FileText className="h-5 w-5 mr-2 text-[#00D4FF]" />
                       <h3 className="text-md font-bold text-white">Prompts History</h3>
                     </div>
                     <div className="overflow-y-auto flex-1 p-4 space-y-3">
                       {userDetails.prompts.length === 0 ? <p className="text-slate-500 text-sm">No prompts found.</p> : userDetails.prompts.map(prompt => (
                         <div key={prompt._id} className="p-3 bg-[#0B0F1A] border border-[#1A2235] rounded-xl">
                           <p className="text-sm text-slate-200 line-clamp-2">{prompt.title || 'Untitled Prompt'}</p>
                           <p className="text-xs text-slate-500 mt-1">{new Date(prompt.createdAt).toLocaleString()}</p>
                         </div>
                       ))}
                     </div>
                  </div>
                </div>

              </div>
            )}
          </div>
        )}
      </div>
      <AppModal
        isOpen={modalConfig.isOpen}
        title={modalConfig.title}
        description={modalConfig.description}
        type={modalConfig.type}
        onConfirm={modalConfig.onConfirm}
        onCancel={modalConfig.onCancel}
        confirmText={modalConfig.confirmText}
        cancelText={modalConfig.cancelText}
      />
    </>
  );
}
