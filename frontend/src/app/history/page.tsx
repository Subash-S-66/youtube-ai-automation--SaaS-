'use client';

import { useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import React from 'react';
import { History, ChevronDown, ChevronUp, Terminal, RefreshCw } from 'lucide-react';
import { authService } from '../../services/authService';
import { pipelineService } from '../../services/pipelineService';
import DashboardLayout from '../../components/layout/DashboardLayout';
import { cn } from '../../lib/utils';

export default function HistoryPage() {
  const [user, setUser] = useState<any>(null);
  const [jobs, setJobs] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [expandedJobId, setExpandedJobId] = useState<string | null>(null);

  useEffect(() => {
    const fetchData = async () => {
      try {
        const userData = await authService.getMe();
        setUser(userData.data);
        const jobsData = await pipelineService.getJobs();
        setJobs(jobsData.data);
      } catch (err) {
        authService.logout();
      } finally {
        setLoading(false);
      }
    };
    fetchData();
  }, []);

  const toggleJob = (id: string) => {
    setExpandedJobId(prev => prev === id ? null : id);
  };

  const getStatusBadge = (status: string) => {
    const colors: any = {
      pending: 'bg-yellow-500/10 text-yellow-500 border-yellow-500/20',
      running: 'bg-blue-500/10 text-blue-500 border-blue-500/20',
      success: 'bg-green-500/10 text-green-500 border-green-500/20',
      failed: 'bg-red-500/10 text-red-500 border-red-500/20',
    };
    return (
      <span className={`px-2.5 py-1 inline-flex text-xs leading-5 font-semibold rounded-full border ${colors[status] || colors.pending}`}>
        {status}
      </span>
    );
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-[#0f172a] flex items-center justify-center">
        <RefreshCw className="h-8 w-8 text-green-500 animate-spin" />
      </div>
    );
  }

  return (
    <DashboardLayout user={user}>

      <div className="bg-[#111827] border border-slate-800 rounded-2xl shadow-xl overflow-hidden">
        <div className="px-6 py-5 border-b border-slate-800 flex items-center justify-between">
          <div className="flex items-center">
            <div className="h-10 w-10 bg-indigo-500/10 rounded-lg flex items-center justify-center mr-4 border border-indigo-500/20">
              <History className="h-5 w-5 text-indigo-400" />
            </div>
            <h2 className="text-xl font-bold text-white">Job History</h2>
          </div>
          <span className="text-sm font-medium text-slate-400 bg-slate-800/50 px-3 py-1 rounded-lg">
            Total Records: {jobs.length}
          </span>
        </div>

        <div className="overflow-x-auto">
          {jobs.length === 0 ? (
            <div className="p-12 text-center flex flex-col items-center justify-center text-slate-500 text-sm">
              <Terminal className="h-12 w-12 text-slate-700 mb-4" />
              <p>No jobs executed yet.</p>
              <p className="mt-1">Head over to the Dashboard to generate your first video.</p>
            </div>
          ) : (
            <table className="min-w-full divide-y divide-slate-800/50">
              <thead className="bg-[#0f172a]/50">
                <tr>
                  <th className="px-6 py-4 text-left text-xs font-semibold text-slate-400 uppercase tracking-wider w-1/4">Date</th>
                  <th className="px-6 py-4 text-left text-xs font-semibold text-slate-400 uppercase tracking-wider w-1/4">Job ID</th>
                  <th className="px-6 py-4 text-left text-xs font-semibold text-slate-400 uppercase tracking-wider w-1/4">Status</th>
                  <th className="px-6 py-4 text-right text-xs font-semibold text-slate-400 uppercase tracking-wider w-1/4">Logs</th>
                </tr>
              </thead>
              <tbody className="bg-[#111827] divide-y divide-slate-800/50">
                {jobs.map((job) => (
                  <React.Fragment key={job._id}>
                    <motion.tr
                      initial={{ opacity: 0 }}
                      animate={{ opacity: 1 }}
                      className={cn("transition-colors", expandedJobId === job._id ? "bg-slate-800/20" : "hover:bg-slate-800/30")}
                    >
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-slate-300">
                        {new Date(job.createdAt).toLocaleString()}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-slate-500 font-mono">
                        {job._id}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap">
                        {getStatusBadge(job.status)}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-right text-sm font-medium">
                        <button
                          onClick={() => toggleJob(job._id)}
                          className="text-indigo-400 hover:text-indigo-300 transition-colors flex items-center justify-end w-full"
                        >
                          {expandedJobId === job._id ? (
                            <><ChevronUp className="h-4 w-4 mr-1" /> Hide Logs</>
                          ) : (
                            <><ChevronDown className="h-4 w-4 mr-1" /> View Logs</>
                          )}
                        </button>
                      </td>
                    </motion.tr>

                    {/* Expandable Logs Section */}
                    <AnimatePresence>
                      {expandedJobId === job._id && (
                        <motion.tr
                          initial={{ opacity: 0, height: 0 }}
                          animate={{ opacity: 1, height: 'auto' }}
                          exit={{ opacity: 0, height: 0 }}
                        >
                          <td colSpan={4} className="px-6 py-4 bg-[#0f172a]/30 border-b border-slate-800">
                            <div className="bg-[#0f172a] rounded-xl p-4 border border-slate-800">
                              <div className="flex items-center mb-3">
                                <Terminal className="h-4 w-4 text-slate-500 mr-2" />
                                <span className="text-xs font-semibold text-slate-400 uppercase tracking-wider">Execution Output</span>
                              </div>
                              <pre className="text-xs text-slate-300 font-mono whitespace-pre-wrap break-words max-h-96 overflow-y-auto custom-scrollbar p-2 bg-[#0a0f1c] rounded-lg border border-slate-800/50">
                                {job.logs || 'No logs recorded.'}
                              </pre>
                            </div>
                          </td>
                        </motion.tr>
                      )}
                    </AnimatePresence>
                  </React.Fragment>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>

    </DashboardLayout>
  );
}
