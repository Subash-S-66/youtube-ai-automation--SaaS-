import type { Metadata } from 'next';
import Link from 'next/link';
import { Shield, ArrowLeft, Lock, FileText, CheckCircle2, Eye, Server, RefreshCw } from 'lucide-react';
import { buildPageMetadata } from '../../lib/seo';

export const metadata: Metadata = buildPageMetadata({
  title: 'Privacy Policy - ClipForge',
  description: 'ClipForge Privacy Policy. Understand how we collect, process, and protect your data, including Google OAuth and YouTube API Services data handling.',
  keywords: ['ClipForge privacy policy', 'ClipForge data security', 'YouTube API compliance'],
  path: '/privacy-policy',
});

export default function PrivacyPolicyPage() {
  return (
    <div className="min-h-screen bg-[#0B0F1A] text-slate-100 font-sans selection:bg-[#7C5CFF]/30 selection:text-white">
      {/* Header */}
      <header className="border-b border-[#1A2235] bg-[#0D1222]/80 backdrop-blur-md sticky top-0 z-50">
        <div className="mx-auto flex max-w-5xl items-center justify-between px-4 py-4 sm:px-8">
          <Link
            href="/"
            className="flex items-center gap-2 text-sm font-semibold text-slate-300 hover:text-white transition-colors"
          >
            <ArrowLeft className="h-4 w-4 text-[#00D4FF]" />
            Back to Home
          </Link>
          <div className="flex items-center gap-2">
            <Shield className="h-5 w-5 text-[#7C5CFF]" />
            <span className="text-base font-bold bg-gradient-to-r from-white via-slate-200 to-slate-400 bg-clip-text text-transparent">
              ClipForge Legal
            </span>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="mx-auto max-w-4xl px-4 py-12 sm:px-8 lg:py-16">
        <div className="mb-10 text-center">
          <div className="inline-flex items-center gap-2 rounded-full border border-[#7C5CFF]/30 bg-[#7C5CFF]/10 px-4 py-1.5 text-xs font-semibold text-[#00D4FF] mb-4">
            <Lock className="h-3.5 w-3.5" />
            Official Policy
          </div>
          <h1 className="text-3xl font-extrabold tracking-tight sm:text-4xl lg:text-5xl text-white mb-3">
            Privacy Policy
          </h1>
          <p className="text-sm text-slate-400">
            Last Updated: July 26, 2026 &bull; Effective Date: July 26, 2026
          </p>
        </div>

        {/* Highlight Card */}
        <div className="mb-10 rounded-2xl border border-[#7C5CFF]/20 bg-gradient-to-br from-[#121829] to-[#0D1222] p-6 shadow-xl sm:p-8">
          <h2 className="flex items-center gap-2 text-lg font-bold text-white mb-3">
            <CheckCircle2 className="h-5 w-5 text-[#00D4FF]" />
            Google OAuth &amp; YouTube API Limited Use Notice
          </h2>
          <p className="text-sm leading-relaxed text-slate-300">
            ClipForge strictly complies with the <strong className="text-white">Google API Services User Data Policy</strong>, including the Limited Use requirements. Information received from Google APIs is used solely to facilitate automated video creation and publishing directly to your connected YouTube channel. We <strong className="text-[#00D4FF]">never sell, share, or transfer</strong> your Google user data to third parties or AI training models.
          </p>
        </div>

        {/* Policy Sections */}
        <div className="space-y-10 text-slate-300 leading-relaxed text-sm">
          {/* Section 1 */}
          <section className="rounded-xl border border-[#1A2235] bg-[#0F1524] p-6 sm:p-8">
            <h2 className="flex items-center gap-2 text-xl font-bold text-white mb-4">
              <Eye className="h-5 w-5 text-[#7C5CFF]" />
              1. Information We Collect
            </h2>
            <div className="space-y-4">
              <div>
                <h3 className="font-semibold text-white mb-1">A. Account Information</h3>
                <p className="text-slate-400">
                  When you register for a ClipForge account, we collect basic details such as your name, email address, password hash, and subscription plan status.
                </p>
              </div>
              <div>
                <h3 className="font-semibold text-white mb-1">B. Google &amp; YouTube User Data</h3>
                <p className="text-slate-400">
                  When you explicitly authorize ClipForge via Google OAuth 2.0 to connect your YouTube channel, we collect your YouTube Channel ID, Channel Name, Channel Avatar URL, and OAuth access/refresh tokens. These credentials allow ClipForge to perform requested actions on your behalf (such as uploading videos and retrieving upload status).
                </p>
              </div>
              <div>
                <h3 className="font-semibold text-white mb-1">C. Content &amp; Media Data</h3>
                <p className="text-slate-400">
                  We store prompts, AI-generated narration scripts, and custom media files (images/videos) you upload to process your video generation requests.
                </p>
              </div>
              <div>
                <h3 className="font-semibold text-white mb-1">D. Payment Information</h3>
                <p className="text-slate-400">
                  All payment transactions are handled securely via accredited payment gateways (Razorpay). ClipForge does <strong className="text-white">not</strong> store your raw debit/credit card numbers or CVV on our servers.
                </p>
              </div>
            </div>
          </section>

          {/* Section 2 */}
          <section className="rounded-xl border border-[#1A2235] bg-[#0F1524] p-6 sm:p-8">
            <h2 className="flex items-center gap-2 text-xl font-bold text-white mb-4">
              <Server className="h-5 w-5 text-[#7C5CFF]" />
              2. How We Use Your Information
            </h2>
            <ul className="list-disc pl-5 space-y-2 text-slate-400">
              <li>To provide, operate, and maintain the ClipForge AI Video Automation platform.</li>
              <li>To generate video scripts using AI models (Gemini API) based on your custom prompts.</li>
              <li>To render short-form video clips and automatically publish them to your connected YouTube channel per your schedule.</li>
              <li>To monitor upload quotas, manage plan limits, and prevent platform abuse.</li>
              <li>To communicate critical account notices, payment receipts, and customer support responses.</li>
            </ul>
          </section>

          {/* Section 3 */}
          <section className="rounded-xl border border-[#1A2235] bg-[#0F1524] p-6 sm:p-8">
            <h2 className="flex items-center gap-2 text-xl font-bold text-white mb-4">
              <Shield className="h-5 w-5 text-[#7C5CFF]" />
              3. YouTube API Services Compliance
            </h2>
            <p className="mb-4 text-slate-400">
              ClipForge utilizes YouTube API Services to upload videos and check upload status. By using our platform, you also agree to be bound by:
            </p>
            <ul className="list-disc pl-5 space-y-2 text-slate-400 mb-4">
              <li>
                <a
                  href="https://www.youtube.com/t/terms"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-[#00D4FF] hover:underline"
                >
                  YouTube Terms of Service
                </a>
              </li>
              <li>
                <a
                  href="https://policies.google.com/privacy"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-[#00D4FF] hover:underline"
                >
                  Google Privacy Policy
                </a>
              </li>
            </ul>
            <p className="text-slate-400">
              You can revoke ClipForge’s access to your Google/YouTube account at any time via the{' '}
              <a
                href="https://myaccount.google.com/permissions"
                target="_blank"
                rel="noopener noreferrer"
                className="text-[#00D4FF] hover:underline"
              >
                Google Security Settings Page
              </a>.
            </p>
          </section>

          {/* Section 4 */}
          <section className="rounded-xl border border-[#1A2235] bg-[#0F1524] p-6 sm:p-8">
            <h2 className="flex items-center gap-2 text-xl font-bold text-white mb-4">
              <RefreshCw className="h-5 w-5 text-[#7C5CFF]" />
              4. Data Retention &amp; Deletion
            </h2>
            <p className="text-slate-400 mb-3">
              We retain your account data and Google OAuth tokens only for as long as your account remains active or as required to deliver our automation services.
            </p>
            <p className="text-slate-400">
              You can request immediate and permanent deletion of your ClipForge account, stored YouTube credentials, and uploaded media at any time by contacting us at{' '}
              <a href="mailto:support@clipforgeapp.tech" className="text-[#00D4FF] hover:underline font-semibold">
                support@clipforgeapp.tech
              </a>. Upon request, all associated credentials and personal data will be erased within 7 business days.
            </p>
          </section>

          {/* Section 5 */}
          <section className="rounded-xl border border-[#1A2235] bg-[#0F1524] p-6 sm:p-8">
            <h2 className="flex items-center gap-2 text-xl font-bold text-white mb-4">
              <Lock className="h-5 w-5 text-[#7C5CFF]" />
              5. Data Security &amp; Encryption
            </h2>
            <p className="text-slate-400">
              ClipForge employs industry-standard security measures including AES-256 encryption at rest for OAuth tokens, HTTPS/TLS encryption in transit, and restricted server access to protect your data against unauthorized access, loss, or alteration.
            </p>
          </section>

          {/* Section 6 */}
          <section className="rounded-xl border border-[#1A2235] bg-[#0F1524] p-6 sm:p-8">
            <h2 className="flex items-center gap-2 text-xl font-bold text-white mb-4">
              <FileText className="h-5 w-5 text-[#7C5CFF]" />
              6. Contact Us
            </h2>
            <p className="text-slate-400">
              If you have any questions or concerns regarding this Privacy Policy or our data practices, please contact us:
            </p>
            <div className="mt-3 text-slate-300 font-medium">
              <p>Email: <a href="mailto:support@clipforgeapp.tech" className="text-[#00D4FF] hover:underline">support@clipforgeapp.tech</a></p>
              <p>Platform: ClipForge AI Video Automation</p>
            </div>
          </section>
        </div>
      </main>

      {/* Footer */}
      <footer className="border-t border-[#1A2235] bg-[#0D1222] py-8 text-center text-xs text-slate-500">
        <p>&copy; {new Date().getFullYear()} ClipForge. All rights reserved.</p>
        <div className="mt-2 flex justify-center gap-4 text-slate-400">
          <Link href="/terms-of-service" className="hover:text-[#00D4FF]">Terms of Service</Link>
          <span>&bull;</span>
          <Link href="/privacy-policy" className="hover:text-[#00D4FF]">Privacy Policy</Link>
        </div>
      </footer>
    </div>
  );
}
