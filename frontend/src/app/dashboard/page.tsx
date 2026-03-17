'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { authService } from '../../services/authService';
import { youtubeService } from '../../services/youtubeService';
import { promptService } from '../../services/promptService';
import { pipelineService } from '../../services/pipelineService';

export default function Dashboard() {
  const router = useRouter();

  // App State
  const [user, setUser] = useState<any>(null);
  const [jobs, setJobs] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  // Form State
  const [prompt, setPrompt] = useState('');
  const [duration, setDuration] = useState<number>(60);
  const [contentType, setContentType] = useState<'clips' | 'images' | 'mixed'>('mixed');
  const [videoCount, setVideoCount] = useState<number>(1);
  const [generating, setGenerating] = useState(false);
  const [message, setMessage] = useState<{ text: string; type: 'success' | 'error' | 'warning' } | null>(null);

  // Initial Data Fetch
  useEffect(() => {
    const fetchData = async () => {
      try {
        const userData = await authService.getMe();
        setUser(userData.data);
        const jobsData = await pipelineService.getJobs();
        setJobs(jobsData.data);
      } catch (err) {
        // Not authenticated or error
        authService.logout();
      } finally {
        setLoading(false);
      }
    };

    fetchData();
  }, []);

  // Poll for jobs periodically
  useEffect(() => {
    let interval: NodeJS.Timeout;
    if (user) {
        interval = setInterval(async () => {
            try {
                const jobsData = await pipelineService.getJobs();
                setJobs(jobsData.data);
            } catch (err) {
                console.error("Failed to refresh jobs");
            }
        }, 5000);
    }
    return () => clearInterval(interval);
  }, [user]);

  const handleConnectYouTube = () => {
    window.location.href = youtubeService.getAuthUrl();
  };

  const handleLogout = () => {
    authService.logout();
  };

  const handleGenerateAndRun = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user?.isYoutubeConnected) {
      setMessage({ text: 'Please connect YouTube first', type: 'error' });
      return;
    }

    setGenerating(true);
    setMessage(null);

    try {
      // Step 1: Generate Prompt
      const promptRes = await promptService.generatePrompt(prompt);
      const promptId = promptRes.data.id;

      // Step 2: Run Pipeline
      const pipelineRes = await pipelineService.runPipeline(promptId, {
        duration,
        contentType,
        videoCount
      });

      if (pipelineRes.warning) {
          setMessage({ text: pipelineRes.warning, type: 'warning' });
      } else {
          setMessage({ text: 'Pipeline started successfully!', type: 'success' });
      }

      // Clear form
      setPrompt('');

      // Refresh jobs instantly
      const jobsData = await pipelineService.getJobs();
      setJobs(jobsData.data);

    } catch (err: any) {
      setMessage({
        text: err.response?.data?.message || 'Failed to generate video',
        type: 'error'
      });
    } finally {
      setGenerating(false);
    }
  };

  if (loading) {
    return <div className="min-h-screen flex items-center justify-center">Loading...</div>;
  }

  return (
    <div className="min-h-screen bg-gray-100 pb-12">
      {/* Navigation */}
      <nav className="bg-white shadow-sm">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex justify-between h-16 items-center">
            <div className="font-bold text-xl text-indigo-600">VideoAutomation</div>
            <div className="flex items-center space-x-4">
              <span className="text-sm text-gray-500">{user?.email}</span>
              <span className="text-xs bg-indigo-100 text-indigo-800 px-2 py-1 rounded-full uppercase font-medium tracking-wide">
                {user?.plan} PLAN
              </span>
              <button
                onClick={handleLogout}
                className="text-sm text-red-600 hover:text-red-800"
              >
                Logout
              </button>
            </div>
          </div>
        </div>
      </nav>

      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 mt-8 space-y-8">

        {/* YouTube Connection Status */}
        <div className="bg-white shadow rounded-lg p-6">
          <h2 className="text-lg font-medium text-gray-900 mb-4">Integrations</h2>
          <div className="flex items-center justify-between">
            <div className="flex items-center space-x-3">
              <div className={`h-3 w-3 rounded-full ${user?.isYoutubeConnected ? 'bg-green-500' : 'bg-red-500'}`}></div>
              <span className="text-sm text-gray-700 font-medium">
                YouTube {user?.isYoutubeConnected ? 'Connected' : 'Not Connected'}
              </span>
            </div>
            {!user?.isYoutubeConnected && (
              <button
                onClick={handleConnectYouTube}
                className="bg-red-600 hover:bg-red-700 text-white px-4 py-2 rounded text-sm font-medium transition"
              >
                Connect YouTube
              </button>
            )}
          </div>
        </div>

        {/* Generate Videos Form */}
        <div className="bg-white shadow rounded-lg p-6">
          <h2 className="text-lg font-medium text-gray-900 mb-4">Generate New Video</h2>

          {message && (
            <div className={`mb-4 p-4 rounded text-sm ${
              message.type === 'error' ? 'bg-red-50 text-red-700' :
              message.type === 'warning' ? 'bg-yellow-50 text-yellow-800' :
              'bg-green-50 text-green-700'
            }`}>
              {message.text}
            </div>
          )}

          <form onSubmit={handleGenerateAndRun} className="space-y-6">
            <div>
              <label className="block text-sm font-medium text-gray-700">Prompt Idea</label>
              <textarea
                required
                rows={3}
                className="mt-1 p-3 block w-full border border-gray-300 rounded-md shadow-sm focus:ring-indigo-500 focus:border-indigo-500 sm:text-sm"
                placeholder="A motivational story about a samurai facing his greatest fear..."
                value={prompt}
                onChange={(e) => setPrompt(e.target.value)}
              />
            </div>

            <div className="grid grid-cols-1 gap-y-6 gap-x-4 sm:grid-cols-3">
              <div>
                <label className="block text-sm font-medium text-gray-700">Duration (seconds)</label>
                <input
                  type="number"
                  required
                  min="10"
                  max="60"
                  className="mt-1 p-2 block w-full border border-gray-300 rounded-md shadow-sm focus:ring-indigo-500 focus:border-indigo-500 sm:text-sm"
                  value={duration}
                  onChange={(e) => setDuration(Number(e.target.value))}
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700">Content Type</label>
                <select
                  className="mt-1 block w-full pl-3 pr-10 py-2 text-base border-gray-300 focus:outline-none focus:ring-indigo-500 focus:border-indigo-500 sm:text-sm rounded-md border"
                  value={contentType}
                  onChange={(e) => setContentType(e.target.value as any)}
                >
                  <option value="clips">Clips</option>
                  <option value="images">Images</option>
                  <option value="mixed">Mixed</option>
                </select>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700">Video Count</label>
                <input
                  type="number"
                  required
                  min="1"
                  className="mt-1 p-2 block w-full border border-gray-300 rounded-md shadow-sm focus:ring-indigo-500 focus:border-indigo-500 sm:text-sm"
                  value={videoCount}
                  onChange={(e) => setVideoCount(Number(e.target.value))}
                />
              </div>
            </div>

            <div className="flex justify-end">
              <button
                type="submit"
                disabled={generating || !user?.isYoutubeConnected}
                className="bg-indigo-600 border border-transparent rounded-md shadow-sm py-2 px-4 inline-flex justify-center text-sm font-medium text-white hover:bg-indigo-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-indigo-500 disabled:opacity-50"
              >
                {generating ? 'Processing...' : 'Generate & Run'}
              </button>
            </div>
          </form>
        </div>

        {/* Job History */}
        <div className="bg-white shadow rounded-lg p-6">
          <h2 className="text-lg font-medium text-gray-900 mb-4">Job History</h2>

          {jobs.length === 0 ? (
            <p className="text-sm text-gray-500">No jobs found.</p>
          ) : (
            <div className="flex flex-col">
              <div className="-my-2 overflow-x-auto sm:-mx-6 lg:-mx-8">
                <div className="py-2 align-middle inline-block min-w-full sm:px-6 lg:px-8">
                  <div className="shadow overflow-hidden border-b border-gray-200 sm:rounded-lg">
                    <table className="min-w-full divide-y divide-gray-200">
                      <thead className="bg-gray-50">
                        <tr>
                          <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                            Date
                          </th>
                          <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                            Status
                          </th>
                          <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                            ID
                          </th>
                        </tr>
                      </thead>
                      <tbody className="bg-white divide-y divide-gray-200">
                        {jobs.map((job) => (
                          <tr key={job._id}>
                            <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                              {new Date(job.createdAt).toLocaleString()}
                            </td>
                            <td className="px-6 py-4 whitespace-nowrap">
                              <span className={`px-2 inline-flex text-xs leading-5 font-semibold rounded-full
                                ${job.status === 'success' ? 'bg-green-100 text-green-800' :
                                  job.status === 'failed' ? 'bg-red-100 text-red-800' :
                                  job.status === 'running' ? 'bg-blue-100 text-blue-800' :
                                  'bg-gray-100 text-gray-800'}`}>
                                {job.status}
                              </span>
                            </td>
                            <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500 font-mono">
                              {job._id}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>

      </div>
    </div>
  );
}
