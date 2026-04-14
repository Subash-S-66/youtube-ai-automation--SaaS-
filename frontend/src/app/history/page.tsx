'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { m, AnimatePresence } from 'framer-motion';




import React from 'react';
import { History, ChevronDown, ChevronUp, Terminal, RefreshCw, Search } from 'lucide-react';
import { authService } from '../../services/authService';
import { pipelineService } from '../../services/pipelineService';
import DashboardLayout from '../../components/layout/DashboardLayout';
import { cn } from '../../lib/utils';

const POLL_INTERVAL_MS = 15000;
const PAGE_SIZE = 10;

interface HistoryJob {
  _id: string;
  createdAt: string;
  completedAt?: string;
  status?: string;
  errorMessage?: string;
  error?: string;
  logs?: string;
  videoUrl?: string;
  youtubeVideoId?: string;
  progress?: {
    progress?: number;
    stage?: string;
    message?: string;
    timestamp?: string;
  } | number;
}

interface JobsResult {
  data: HistoryJob[];
  pagination?: {
    total?: number;
    pages?: number;
    nextCursor?: string | null;
  };
}

interface UserResult {
  data: Record<string, unknown>;
}

const RUNTIME_STAGES = new Set([
  'processing',
  'dispatch',
  'content_load',
  'content_generation',
  'payload_build',
  'token_validation',
  'pipeline_runtime',
  'upload_confirmation_pending',
]);

export default function HistoryPage() {
  const [user, setUser] = useState<Record<string, unknown> | null>(null);
  const [jobs, setJobs] = useState<HistoryJob[]>([]);
  const [loading, setLoading] = useState(true);
  const [listLoading, setListLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [expandedJobId, setExpandedJobId] = useState<string | null>(null);

  const [totalRecords, setTotalRecords] = useState(0);
  const [searchInput, setSearchInput] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const jobsRef = useRef<HistoryJob[]>([]);

  const isRuntimeInFlight = useCallback((job: HistoryJob) => {
    const progressValue = typeof job.progress === 'number'
      ? job.progress
      : (typeof job.progress === 'object' ? Number(job.progress?.progress || 0) : 0);
    const stage = String(typeof job.progress === 'object' ? (job.progress?.stage || '') : '').toLowerCase();
    return Number.isFinite(progressValue) && progressValue >= 0 && progressValue < 100 && RUNTIME_STAGES.has(stage);
  }, []);

  const isActiveJob = useCallback((job: HistoryJob) => {
    const status = String(job?.status || '').toLowerCase();
    if (['queued', 'pending', 'processing', 'running'].includes(status)) {
      return true;
    }
    if (['success', 'completed', 'failed', 'cancelled', 'canceled', 'timeout'].includes(status)) {
      return false;
    }
    return isRuntimeInFlight(job);
  }, [isRuntimeInFlight]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setDebouncedSearch(searchInput.trim());
    }, 300);

    return () => {
      window.clearTimeout(timer);
    };
  }, [searchInput]);

  useEffect(() => {
    let active = true;

    const fetchFirstPage = async (opts?: { includeUser?: boolean; silent?: boolean }) => {
      const includeUser = !!opts?.includeUser;
      const silent = !!opts?.silent;

      if (silent) {
        setRefreshing(true);
      } else {
        setListLoading(true);
      }

      try {
        const [userData, jobsData] = await Promise.all([
          includeUser ? authService.getMe() : Promise.resolve(null),
          pipelineService.getJobs(1, PAGE_SIZE, { includeTotal: true, search: debouncedSearch }),
        ]) as [UserResult | null, JobsResult];

        if (!active) return;

        if (includeUser && userData) {
          setUser(userData.data);
        }

        const fetchedJobs: HistoryJob[] = Array.isArray(jobsData.data) ? jobsData.data : [];
        setJobs(fetchedJobs);
        jobsRef.current = fetchedJobs;

        const cursorValue = jobsData.pagination?.nextCursor;
        setNextCursor(typeof cursorValue === 'string' && cursorValue.trim() ? cursorValue : null);
        setTotalRecords(Number(jobsData.pagination?.total || fetchedJobs.length || 0));
      } catch (err) {
        if (!silent) {
          authService.handleAuthError(err);
        }
      } finally {
        if (!active) return;
        setLoading(false);
        if (silent) {
          setRefreshing(false);
        } else {
          setListLoading(false);
        }
      }
    };

    const refreshActiveHead = async () => {
      setRefreshing(true);
      try {
        const jobsData = await pipelineService.getJobs(1, PAGE_SIZE, { includeTotal: false, search: debouncedSearch });
        if (!active) return;
        const latestJobs: HistoryJob[] = Array.isArray(jobsData.data) ? jobsData.data : [];

        setJobs((prev: HistoryJob[]) => {
          const seen = new Set(latestJobs.map((item: HistoryJob) => item._id));
          const merged = [...latestJobs, ...prev.filter((item: HistoryJob) => !seen.has(item._id))];
          jobsRef.current = merged;
          return merged;
        });
      } catch {
        // Polling should be best-effort and silent.
      } finally {
        if (active) {
          setRefreshing(false);
        }
      }
    };

    void fetchFirstPage({ includeUser: !user, silent: false });

    const interval = window.setInterval(() => {
      if (document.hidden) return;
      if (!jobsRef.current.some(isActiveJob)) return;
      void refreshActiveHead();
    }, POLL_INTERVAL_MS);

    return () => {
      active = false;
      window.clearInterval(interval);
    };
  }, [debouncedSearch, isActiveJob, user]);

  const handleManualRefresh = async () => {
    setListLoading(true);
    setRefreshing(true);
    try {
      const jobsData = await pipelineService.getJobs(1, PAGE_SIZE, { includeTotal: true, search: debouncedSearch });
      const fetchedJobs: HistoryJob[] = Array.isArray(jobsData.data) ? jobsData.data : [];
      setJobs(fetchedJobs);
      jobsRef.current = fetchedJobs;
      const cursorValue = jobsData.pagination?.nextCursor;
      setNextCursor(typeof cursorValue === 'string' && cursorValue.trim() ? cursorValue : null);
      setTotalRecords(Number(jobsData.pagination?.total || fetchedJobs.length || 0));
    } finally {
      setListLoading(false);
      setRefreshing(false);
    }
  };

  const handleLoadMore = async () => {
    if (!nextCursor || loadingMore || listLoading) {
      return;
    }

    setLoadingMore(true);
    try {
      const jobsData = await pipelineService.getJobs(1, PAGE_SIZE, {
        cursor: nextCursor,
        includeTotal: false,
        search: debouncedSearch,
      });
      const moreJobs: HistoryJob[] = Array.isArray(jobsData.data) ? jobsData.data : [];

      setJobs((prev: HistoryJob[]) => {
        const seen = new Set(prev.map((item: HistoryJob) => item._id));
        const appendJobs = moreJobs.filter((item: HistoryJob) => !seen.has(item._id));
        const merged = [...prev, ...appendJobs];
        jobsRef.current = merged;
        return merged;
      });

      const cursorValue = jobsData.pagination?.nextCursor;
      setNextCursor(typeof cursorValue === 'string' && cursorValue.trim() ? cursorValue : null);
    } finally {
      setLoadingMore(false);
    }
  };

  const toggleJob = (id: string) => {
    setExpandedJobId(prev => prev === id ? null : id);
  };

  const isQueueTimeoutJob = (job: HistoryJob) => {
    const haystack = `${job?.errorMessage || ''} ${job?.error || ''} ${job?.logs || ''}`.toLowerCase();
    return haystack.includes('queue timeout') || haystack.includes('waiting in queue for more than 2 hours');
  };

  const hasYouTubeUploadProof = (job: HistoryJob) => {
    const videoId = String(job?.youtubeVideoId || '').trim();
    const videoUrl = String(job?.videoUrl || '').trim();
    return Boolean(videoId || /^https?:\/\//i.test(videoUrl));
  };

  const resolveRawProgressValue = (job: HistoryJob) => {
    if (typeof job.progress === 'number' && Number.isFinite(job.progress)) {
      return Math.max(0, Math.min(100, Math.round(job.progress)));
    }
    const value = typeof job.progress === 'object' ? job.progress?.progress : undefined;
    if (typeof value === 'number' && Number.isFinite(value)) {
      return Math.max(0, Math.min(100, Math.round(value)));
    }
    return null;
  };

  const getDisplayStatus = (job: HistoryJob) => {
    const normalizedStatus = String(job?.status || '').toLowerCase();
    if (normalizedStatus === 'failed' && isQueueTimeoutJob(job)) {
      return 'timeout';
    }
    if (normalizedStatus === 'success' || normalizedStatus === 'completed') {
      const progressValue = resolveRawProgressValue(job);
      const hasFullProgress = progressValue !== null && progressValue >= 100;
      if (!hasFullProgress || !hasYouTubeUploadProof(job)) {
        return 'processing';
      }
    }
    if (['queued', 'pending', 'processing', 'running'].includes(normalizedStatus) && isRuntimeInFlight(job)) {
      return 'processing';
    }
    if (normalizedStatus) {
      return normalizedStatus;
    }
    if (isRuntimeInFlight(job)) {
      return 'processing';
    }
    return 'queued';
  };

  const getStatusBadge = (status: string) => {
    const colors: Record<string, string> = {
      queued: 'bg-yellow-500/10 text-yellow-500 border-yellow-500/20',
      pending: 'bg-yellow-500/10 text-yellow-500 border-yellow-500/20', // legacy support
      processing: 'bg-[#00D4FF]/10 text-[#00D4FF] border-[#00D4FF]/20',
      running: 'bg-[#00D4FF]/10 text-[#00D4FF] border-[#00D4FF]/20',
      completed: 'bg-[#7C5CFF]/10 text-[#7C5CFF] border-[#7C5CFF]/20',
      success: 'bg-[#7C5CFF]/10 text-[#7C5CFF] border-[#7C5CFF]/20', // legacy support
      failed: 'bg-[#FF4FD8]/10 text-[#FF4FD8] border-[#FF4FD8]/20',
      timeout: 'bg-red-500/10 text-red-400 border-red-500/20',
    };
    return (
      <span className={`px-2.5 py-1 inline-flex text-xs leading-5 font-semibold rounded-full border ${colors[status] || colors.queued}`}>
        {status}
      </span>
    );
  };

  const resolveProgressValue = (job: HistoryJob) => {
    if (typeof job.progress === 'number' && Number.isFinite(job.progress)) {
      return Math.max(0, Math.min(100, Math.round(job.progress)));
    }
    const value = typeof job.progress === 'object' ? job.progress?.progress : undefined;
    if (typeof value === 'number' && Number.isFinite(value)) {
      return Math.max(0, Math.min(100, Math.round(value)));
    }
    return null;
  };

  const clampProgressForStatus = (value: number, status: string) => {
    const normalized = status.toLowerCase();
    if (normalized === 'success' || normalized === 'completed') {
      return value;
    }
    return Math.min(value, 99);
  };

  const resolveProgressStage = (job: HistoryJob) => {
    if (typeof job.progress === 'object' && job.progress?.stage) {
      return job.progress.stage;
    }
    return '';
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

        <div className="px-3 sm:px-6 py-4 sm:py-5 border-b border-[#1A2235] flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center min-w-0">
            <div className="h-10 w-10 bg-[#7C5CFF]/10 rounded-xl flex items-center justify-center mr-3 sm:mr-4 border border-[#7C5CFF]/20 shadow-glow-primary">
              <History className="h-5 w-5 text-[#7C5CFF]" />
            </div>
            <h2 className="text-lg sm:text-xl font-bold text-white tracking-tight truncate">Job History</h2>
            {refreshing && (
              <RefreshCw className="h-4 w-4 ml-3 animate-spin text-slate-500" />
            )}
          </div>
          <div className="w-full sm:w-auto flex items-center gap-2">
            <div className="relative flex-1 sm:flex-none sm:w-64">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-slate-500" />
              <input
                type="text"
                value={searchInput}
                onChange={(e) => setSearchInput(e.target.value)}
                placeholder="Search status/error"
                className="w-full rounded-lg border border-[#1A2235] bg-[#0B0F1A] pl-8 pr-3 py-1.5 text-sm text-slate-200 focus:outline-none focus:border-[#7C5CFF]"
              />
            </div>
            <button
              onClick={handleManualRefresh}
              disabled={refreshing || listLoading}
              className="inline-flex items-center justify-center gap-1 text-sm font-medium text-slate-300 bg-[#1A2235]/50 px-3 py-1 rounded-lg border border-[#1A2235] hover:bg-[#1A2235] disabled:opacity-60 transition-colors"
            >
              <RefreshCw className={cn('h-3.5 w-3.5', (refreshing || listLoading) && 'animate-spin')} />
              Refresh
            </button>
            <span className="text-xs sm:text-sm font-medium text-slate-400 bg-[#1A2235]/50 px-3 py-1 rounded-lg border border-[#1A2235]">
              Total Records: {totalRecords}
            </span>
          </div>
        </div>

        <div className="overflow-hidden">
          {jobs.length === 0 ? (
            <div className="p-8 sm:p-12 text-center flex flex-col items-center justify-center text-slate-500 text-sm">
              <Terminal className="mb-4 h-12 w-12 text-white" />
              <p>No jobs executed yet.</p>
              <p className="mt-1">Head over to the Dashboard to generate your first video.</p>
            </div>
          ) : (
            <>
              <div className="md:hidden divide-y divide-[#1A2235]">
                {jobs.map((job) => {
                  const displayStatus = getDisplayStatus(job);
                  const progressValue = resolveProgressValue(job);
                  const boundedProgress = progressValue === null
                    ? null
                    : clampProgressForStatus(progressValue, displayStatus);
                  const stageLabel = resolveProgressStage(job);
                  const isExpanded = expandedJobId === job._id;

                  return (
                    <div key={job._id} className="p-4 bg-[#111827]">
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <p className="text-sm text-slate-300">{new Date(job.createdAt).toLocaleString()}</p>
                          <p className="mt-2 text-[11px] uppercase tracking-wider text-slate-500">Job ID</p>
                          <p className="mt-1 text-xs text-[#00D4FF] font-mono break-all">{job._id}</p>
                        </div>
                        <div className="shrink-0">
                          {getStatusBadge(displayStatus)}
                        </div>
                      </div>

                      {boundedProgress !== null && (
                        <div className="mt-3">
                          <div className="h-2 w-full bg-[#0B0F1A] rounded-full overflow-hidden border border-[#1A2235]">
                            <div
                              className="h-full bg-gradient-to-r from-[#00D4FF] to-[#7C5CFF]"
                              style={{ width: `${boundedProgress}%` }}
                            />
                          </div>
                          <div className="mt-1 text-[11px] text-slate-400">
                            {boundedProgress}%{stageLabel ? ` • ${stageLabel}` : ''}
                          </div>
                        </div>
                      )}

                      <button
                        onClick={() => toggleJob(job._id)}
                        className="mt-3 text-[#7C5CFF] hover:text-[#FF4FD8] transition-colors inline-flex items-center text-sm"
                      >
                        {isExpanded ? (
                          <><ChevronUp className="h-4 w-4 mr-1" /> Hide Logs</>
                        ) : (
                          <><ChevronDown className="h-4 w-4 mr-1" /> View Logs</>
                        )}
                      </button>

                      <AnimatePresence>
                        {isExpanded && (
                          <m.div
                            initial={{ opacity: 0, height: 0 }}
                            animate={{ opacity: 1, height: 'auto' }}
                            exit={{ opacity: 0, height: 0 }}
                            className="overflow-hidden"
                          >
                            <div className="mt-3 bg-[#0B0F1A] rounded-xl p-3 border border-[#1A2235] shadow-inner">
                              <div className="flex items-center mb-2">
                                <Terminal className="h-4 w-4 text-[#7C5CFF] mr-2" />
                                <span className="text-xs font-semibold text-slate-400 uppercase tracking-wider">Execution Output</span>
                              </div>
                              <pre className="text-xs text-slate-300 font-mono whitespace-pre-wrap break-words max-h-72 overflow-y-auto overflow-x-hidden custom-scrollbar p-3 bg-[#05080f] rounded-lg border border-[#1A2235]/50 leading-relaxed tracking-wide">
                                {job.logs || 'No logs recorded.'}
                              </pre>
                            </div>
                          </m.div>
                        )}
                      </AnimatePresence>
                    </div>
                  );
                })}
              </div>

              <div className="hidden md:block overflow-x-hidden">
                <table className="w-full table-fixed divide-y divide-[#1A2235]">
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
                          <td className="px-6 py-4 text-sm text-[#00D4FF] font-mono opacity-80 max-w-[300px] break-all">
                            {job._id}
                          </td>
                          <td className="px-6 py-4 whitespace-nowrap">
                            {getStatusBadge(getDisplayStatus(job))}
                            {(() => {
                              const progressValue = resolveProgressValue(job);
                              if (progressValue === null) return null;
                              const boundedProgress = clampProgressForStatus(progressValue, getDisplayStatus(job));
                              const stageLabel = resolveProgressStage(job);
                              return (
                                <div className="mt-2">
                                  <div className="h-2 w-40 bg-[#0B0F1A] rounded-full overflow-hidden border border-[#1A2235]">
                                    <div
                                      className="h-full bg-gradient-to-r from-[#00D4FF] to-[#7C5CFF]"
                                      style={{ width: `${boundedProgress}%` }}
                                    />
                                  </div>
                                  <div className="mt-1 text-[11px] text-slate-400">
                                    {boundedProgress}%{stageLabel ? ` • ${stageLabel}` : ''}
                                  </div>
                                </div>
                              );
                            })()}
                          </td>
                          <td className="px-6 py-4 whitespace-nowrap text-right text-sm font-medium">
                            <button
                              onClick={() => toggleJob(job._id)}
                              className="text-[#7C5CFF] hover:text-[#FF4FD8] transition-colors inline-flex items-center"
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
                              initial={{ opacity: 0 }}
                              animate={{ opacity: 1 }}
                              exit={{ opacity: 0 }}
                            >
                              <td colSpan={4} className="px-6 py-4 bg-[#0B0F1A]/80 border-b border-[#1A2235]">
                                <div className="bg-[#0B0F1A] rounded-xl p-4 border border-[#1A2235] shadow-inner">
                                  <div className="flex items-center mb-3">
                                    <Terminal className="h-4 w-4 text-[#7C5CFF] mr-2" />
                                    <span className="text-xs font-semibold text-slate-400 uppercase tracking-wider">Execution Output</span>
                                  </div>
                                  <pre className="text-xs text-slate-300 font-mono whitespace-pre-wrap break-words max-h-96 overflow-y-auto overflow-x-hidden custom-scrollbar p-3 bg-[#05080f] rounded-lg border border-[#1A2235]/50 leading-relaxed tracking-wide">
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
              </div>
            </>
          )}
        </div>
      </div>

      <div className="p-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between bg-[#111827] border border-[#1A2235] rounded-xl mt-6 shadow-xl">
        <span className="text-sm text-slate-400 text-center sm:text-left">
          Loaded {jobs.length} of {Math.max(totalRecords, jobs.length)} records
        </span>
        <button
          type="button"
          onClick={handleLoadMore}
          disabled={!nextCursor || loadingMore || listLoading || loading}
          className="w-full sm:w-auto px-4 py-2 bg-[#1A2235] text-slate-300 rounded-lg text-sm disabled:opacity-50 hover:bg-[#2a3550] transition-colors inline-flex items-center justify-center gap-2"
        >
          {loadingMore ? <RefreshCw className="h-3.5 w-3.5 animate-spin" /> : null}
          {nextCursor ? 'Load More' : 'No More Records'}
        </button>
      </div>

    </DashboardLayout>
  );
}
