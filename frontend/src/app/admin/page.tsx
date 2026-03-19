"use client";

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { motion, AnimatePresence } from 'framer-motion';
import { Users, CreditCard, DollarSign, RefreshCw, ChevronLeft, Search, Save, History as HistoryIcon, FileText } from 'lucide-react';
import { adminService } from '../../services/adminService';
import { authService } from '../../services/authService';
import DashboardLayout from '../../components/layout/DashboardLayout';
import { cn } from '../../lib/utils';

interface AdminStats {
  totalUsers: number;
  totalActiveSubscriptions: number;
  totalEarnings: number;
}

interface UserSummary {
  _id: string;
  email: string;
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

export default function AdminDashboard() {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [stats, setStats] = useState<AdminStats | null>(null);
  const [users, setUsers] = useState<UserSummary[]>([]);
  const [selectedUserId, setSelectedUserId] = useState<string | null>(null);
  const [userDetails, setUserDetails] = useState<UserDetails | null>(null);
  const [currentUser, setCurrentUser] = useState<any>(null);

  // Edit forms
  const [editPlan, setEditPlan] = useState('free');
  const [editExpiry, setEditExpiry] = useState('');
  const [savingPlan, setSavingPlan] = useState(false);

  useEffect(() => {
    const initAdmin = async () => {
      try {
        const me = await authService.getMe();
        if (me?.data?.user?.role !== 'admin') {
          router.push('/dashboard');
          return;
        }

        setCurrentUser(me.data.user);

        const [statsData, usersData] = await Promise.all([
          adminService.getStats(),
          adminService.getUsers()
        ]);

        setStats(statsData.data);
        setUsers(usersData.data);
      } catch (error) {
        console.error("Admin init error", error);
        router.push('/dashboard');
      } finally {
        setLoading(false);
      }
    };
    initAdmin();
  }, [router]);

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
      // Refresh user details
      await loadUserDetails(selectedUserId);
      // Refresh list
      const usersData = await adminService.getUsers();
      setUsers(usersData.data);
    } catch (err) {
      console.error(err);
      alert('Failed to update plan.');
    } finally {
      setSavingPlan(false);
    }
  };

  if (loading) {
    return (
      <DashboardLayout user={currentUser}>
        <div className="flex justify-center items-center h-[50vh]">
          <RefreshCw className="h-8 w-8 animate-spin text-[#7C5CFF]" />
        </div>
      </DashboardLayout>
    );
  }

  return (
    <DashboardLayout user={currentUser}>
      <div className="max-w-7xl mx-auto py-8">
        {!selectedUserId ? (
          <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="space-y-8">
            <h1 className="text-3xl font-extrabold text-transparent bg-clip-text bg-gradient-to-r from-white to-slate-400">Admin Panel</h1>

            {/* Stats Cards */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
              <div className="bg-[#111827] border border-[#1A2235] p-6 rounded-2xl flex items-center shadow-lg">
                <div className="p-4 rounded-xl bg-[#7C5CFF]/10 text-[#7C5CFF] mr-4"><Users className="h-6 w-6" /></div>
                <div><p className="text-slate-400 text-sm font-medium">Total Users</p><p className="text-2xl font-bold text-white">{stats?.totalUsers || 0}</p></div>
              </div>
              <div className="bg-[#111827] border border-[#1A2235] p-6 rounded-2xl flex items-center shadow-lg">
                <div className="p-4 rounded-xl bg-[#00D4FF]/10 text-[#00D4FF] mr-4"><CreditCard className="h-6 w-6" /></div>
                <div><p className="text-slate-400 text-sm font-medium">Active Subscriptions</p><p className="text-2xl font-bold text-white">{stats?.totalActiveSubscriptions || 0}</p></div>
              </div>
              <div className="bg-[#111827] border border-[#1A2235] p-6 rounded-2xl flex items-center shadow-lg">
                <div className="p-4 rounded-xl bg-green-500/10 text-green-500 mr-4"><DollarSign className="h-6 w-6" /></div>
                <div><p className="text-slate-400 text-sm font-medium">Est. MRR</p><p className="text-2xl font-bold text-white">${stats?.totalEarnings || 0}</p></div>
              </div>
            </div>

            {/* Users Table */}
            <div className="bg-[#111827] border border-[#1A2235] rounded-2xl shadow-xl overflow-hidden">
              <div className="p-6 border-b border-[#1A2235] flex justify-between items-center">
                <h2 className="text-xl font-bold text-white">Users Directory</h2>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse">
                  <thead>
                    <tr className="bg-[#0B0F1A] text-slate-400 text-xs uppercase tracking-wider">
                      <th className="p-4 font-medium">Email</th>
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
                          <span className={cn("px-2.5 py-1 text-xs font-bold rounded-lg border", u.plan === 'free' ? "bg-slate-500/10 text-slate-300 border-slate-500/20" : "bg-[#7C5CFF]/10 text-[#7C5CFF] border-[#7C5CFF]/20")}>{u.plan.toUpperCase()}</span>
                        </td>
                        <td className="p-4 text-slate-400 hidden sm:table-cell">{u.uploadsUsedToday}</td>
                        <td className="p-4 text-slate-400 hidden sm:table-cell">{u.uploadsOnHold}</td>
                        <td className="p-4 text-slate-400 hidden md:table-cell">{u.subscriptionExpiresAt ? new Date(u.subscriptionExpiresAt).toLocaleDateString() : 'N/A'}</td>
                      </tr>
                    ))}
                    {users.length === 0 && (
                      <tr><td colSpan={5} className="p-8 text-center text-slate-500">No users found.</td></tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </motion.div>
        ) : (
          <motion.div initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} className="space-y-6">
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
                        <select value={editPlan} onChange={(e) => setEditPlan(e.target.value)} className="w-full bg-[#0B0F1A] text-white px-3 py-2 rounded-lg border border-[#1A2235] focus:border-[#7C5CFF] focus:outline-none">
                          <option value="free">Free</option>
                          <option value="basic">Basic</option>
                          <option value="pro">Pro</option>
                          <option value="premium">Premium</option>
                        </select>
                      </div>
                      <div>
                        <label className="block text-xs text-slate-400 uppercase tracking-wider mb-1">Expiry Date</label>
                        <input type="date" value={editExpiry} onChange={(e) => setEditExpiry(e.target.value)} className="w-full bg-[#0B0F1A] text-white px-3 py-2 rounded-lg border border-[#1A2235] focus:border-[#7C5CFF] focus:outline-none [color-scheme:dark]" />
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
                </div>

                {/* History & Logs */}
                <div className="lg:col-span-2 space-y-6">
                  {/* Jobs */}
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

                  {/* Prompts */}
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
          </motion.div>
        )}
      </div>
    </DashboardLayout>
  );
}
