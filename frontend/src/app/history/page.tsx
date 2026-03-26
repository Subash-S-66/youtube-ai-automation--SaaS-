'use client';

import { useEffect, useState } from 'react';
import dynamic from 'next/dynamic';
import { m, AnimatePresence } from 'framer-motion';




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

  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);

  useEffect(() => {
    const fetchData = async () => {
      setLoading(true);
      try {
        const [userData, jobsData] = await Promise.all([
          authService.getMe(),
          pipelineService.getJobs(page, 10)
        ]);
        setUser(userData.data);
        setJobs(jobsData.data);
        setTotalPages(jobsData.pagination?.pages || 1);
      } catch (err) {
        authService.handleAuthError(err);
      } finally {
        setLoading(false);
      }
    };
    fetchData();
  }, [page]);

  const toggleJob = (id: string) => {
    setExpandedJobId(prev => prev === id ? null : id);
  };

  const getStatusBadge = (status: string) => {
    const colors: any = {
      queued: 'bg-yellow-500/10 text-yellow-500 border-yellow-500/20',
      pending: 'bg-yellow-500/10 text-yellow-500 border-yellow-500/20', // legacy support
      processing: 'bg-[#00D4FF]/10 text-[#00D4FF] border-[#00D4FF]/20',
      running: 'bg-[#00D4FF]/10 text-[#00D4FF] border-[#00D4FF]/20',
      completed: 'bg-[#7C5CFF]/10 text-[#7C5CFF] border-[#7C5CFF]/20',
      success: 'bg-[#7C5CFF]/10 text-[#7C5CFF] border-[#7C5CFF]/20', // legacy support
      failed: 'bg-[#FF4FD8]/10 text-[#FF4FD8] border-[#FF4FD8]/20',
    };
    return (
      <span className={`px-2.5 py-1 inline-flex text-xs leading-5 font-semibold rounded-full border ${colors[status] || colors.queued}`}>
        {status}
      </span>
    );
  };

  if (loading) {
    return (
      <DashboardLayout user={user}>
        <div className="flex items-center space-x-3 text-slate-400 text-sm">
          <RefreshCw className="h-4 w-4 animate-spin text-[#7C5CFF]" />
          <span>Loading history…</span>
        </div>
      </DashboardLayout>
    );
  }

  return (
    <DashboardLayout user={user}>

      <div className="bg-[#111827] border border-[#1A2235] rounded-2xl shadow-xl overflow-hidden relative">
        {/* Subtle top glow */}
        <div className="absolute top-0 left-0 w-full h-[1px] bg-gradient-primary opacity-50"></div>

        <div className="px-6 py-5 border-b border-[#1A2235] flex items-center justify-between">
          <div className="flex items-center">
            <div className="h-10 w-10 bg-[#7C5CFF]/10 rounded-xl flex items-center justify-center mr-4 border border-[#7C5CFF]/20 shadow-glow-primary">
              <History className="h-5 w-5 text-[#7C5CFF]" />
            </div>
            <h2 className="text-xl font-bold text-white tracking-tight">Job History</h2>
          </div>
          <span className="text-sm font-medium text-slate-400 bg-[#1A2235]/50 px-3 py-1 rounded-lg border border-[#1A2235]">
            Total Records: {jobs.length}
          </span>
        </div>

        <div className="overflow-x-auto">
          {jobs.length === 0 ? (
            <div className="p-12 text-center flex flex-col items-center justify-center text-slate-500 text-sm">
              <Terminal className="h-12 w-12 text-[#1A2235] mb-4" />
              <p>No jobs executed yet.</p>
              <p className="mt-1">Head over to the Dashboard to generate your first video.</p>
            </div>
          ) : (
            <table className="min-w-full divide-y divide-[#1A2235]">
              <thead className="bg-[#0B0F1A]/50">
                <tr>
                  <th className="px-6 py-4 text-left text-xs font-semibold text-slate-400 uppercase tracking-wider w-1/4">Date</th>
                  <th className="px-6 py-4 text-left text-xs font-semibold text-slate-400 uppercase tracking-wider w-1/4">Job ID</th>
                  <th className="px-6 py-4 text-left text-xs font-semibold text-slate-400 uppercase tracking-wider w-1/4">Status</th>
                  <th className="px-6 py-4 text-right text-xs font-semibold text-slate-400 uppercase tracking-wider w-1/4">Logs</th>
                </tr>
              </thead>
              <tbody className="bg-[#111827] divide-y divide-[#1A2235]">
                {jobs.map((job) => (
                  <React.Fragment key={job._id}>
                    <m.tr
                      initial={{ opacity: 0 }}
                      animate={{ opacity: 1 }}
                      className={cn("transition-colors", expandedJobId === job._id ? "bg-[#1A2235]/20" : "hover:bg-[#1A2235]/40")}
                    >
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-slate-300">
                        {new Date(job.createdAt).toLocaleString()}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-[#00D4FF] font-mono opacity-80">
                        {job._id}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap">
                        {getStatusBadge(job.status)}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-right text-sm font-medium">
                        <button
                          onClick={() => toggleJob(job._id)}
                          className="text-[#7C5CFF] hover:text-[#FF4FD8] transition-colors flex items-center justify-end w-full"
                        >
                          {expandedJobId === job._id ? (
                            <><ChevronUp className="h-4 w-4 mr-1" /> Hide Logs</>
                          ) : (
                            <><ChevronDown className="h-4 w-4 mr-1" /> View Logs</>
                          )}
                        </button>
                      </td>
                    </m.tr>

                    {/* Expandable Logs Section */}
                    <AnimatePresence>
                      {expandedJobId === job._id && (
                        <m.tr
                          initial={{ opacity: 0, height: 0 }}
                          animate={{ opacity: 1, height: 'auto' }}
                          exit={{ opacity: 0, height: 0 }}
                        >
                          <td colSpan={4} className="px-6 py-4 bg-[#0B0F1A]/80 border-b border-[#1A2235]">
                            <div className="bg-[#0B0F1A] rounded-xl p-4 border border-[#1A2235] shadow-inner">
                              <div className="flex items-center mb-3">
                                <Terminal className="h-4 w-4 text-[#7C5CFF] mr-2" />
                                <span className="text-xs font-semibold text-slate-400 uppercase tracking-wider">Execution Output</span>
                              </div>
                              <pre className="text-xs text-slate-300 font-mono whitespace-pre-wrap break-words max-h-96 overflow-y-auto custom-scrollbar p-3 bg-[#05080f] rounded-lg border border-[#1A2235]/50 leading-relaxed tracking-wide">
                                {job.logs || 'No logs recorded.'}
                              </pre>
                            </div>
                          </td>
                        </m.tr>
                      )}
                    </AnimatePresence>
                  </React.Fragment>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>

      {totalPages > 1 && (
        <div className="p-4 flex items-center justify-between bg-[#111827] border border-[#1A2235] rounded-xl mt-6 shadow-xl">
          <button
            onClick={() => setPage(p => Math.max(1, p - 1))}
            disabled={page === 1 || loading}
            className="px-4 py-2 bg-[#1A2235] text-slate-300 rounded-lg text-sm disabled:opacity-50 hover:bg-[#2a3550] transition-colors"
          >
            Previous
          </button>
          <span className="text-sm text-slate-400">
            Page {page} of {totalPages}
          </span>
          <button
            onClick={() => setPage(p => Math.min(totalPages, p + 1))}
            disabled={page === totalPages || loading}
            className="px-4 py-2 bg-[#1A2235] text-slate-300 rounded-lg text-sm disabled:opacity-50 hover:bg-[#2a3550] transition-colors"
          >
            Next
          </button>
        </div>
      )}

    </DashboardLayout>
  );
}
