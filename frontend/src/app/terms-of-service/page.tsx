import type { Metadata } from 'next';
import Link from 'next/link';
import { Shield, ArrowLeft, FileText, AlertTriangle, CreditCard, Ban, Scale, HelpCircle } from 'lucide-react';
import { buildPageMetadata } from '../../lib/seo';

export const metadata: Metadata = buildPageMetadata({
  title: 'Terms of Service - ClipForge',
  description: 'ClipForge Terms of Service and End User Agreement. Understand subscription billing, strict no-refund policy, user conduct, and account termination rules.',
  keywords: ['ClipForge terms of service', 'ClipForge terms and conditions', 'no refund policy'],
  path: '/terms-of-service',
});

export default function TermsOfServicePage() {
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
            <FileText className="h-3.5 w-3.5" />
            Terms &amp; Conditions
          </div>
          <h1 className="text-3xl font-extrabold tracking-tight sm:text-4xl lg:text-5xl text-white mb-3">
            Terms of Service
          </h1>
          <p className="text-sm text-slate-400">
            Last Updated: July 26, 2026 &bull; Effective Date: July 26, 2026
          </p>
        </div>

        {/* Critical Notice Banners */}
        <div className="grid gap-6 sm:grid-cols-2 mb-10">
          {/* No Refunds Notice */}
          <div className="rounded-2xl border border-amber-500/30 bg-gradient-to-br from-[#1E1912] to-[#120F0D] p-6 shadow-lg">
            <h2 className="flex items-center gap-2 text-base font-bold text-amber-400 mb-2">
              <CreditCard className="h-5 w-5 text-amber-400" />
              Strict No-Refund Policy
            </h2>
            <p className="text-xs leading-relaxed text-slate-300">
              All subscription fees, plan upgrades, and service purchases are <strong className="text-white">100% non-refundable</strong> under any circumstances once processed via Razorpay or any payment gateway.
            </p>
          </div>

          {/* Account Termination Notice */}
          <div className="rounded-2xl border border-red-500/30 bg-gradient-to-br from-[#201114] to-[#140B0D] p-6 shadow-lg">
            <h2 className="flex items-center gap-2 text-base font-bold text-rose-400 mb-2">
              <Ban className="h-5 w-5 text-rose-400" />
              Prohibited Conduct &amp; Account Bans
            </h2>
            <p className="text-xs leading-relaxed text-slate-300">
              Accounts engaging in illegal activities, automated spamming, copyright violation, or YouTube API policy violations will be <strong className="text-white">permanently banned immediately</strong> without prior notice or refund.
            </p>
          </div>
        </div>

        {/* Terms Sections */}
        <div className="space-y-10 text-slate-300 leading-relaxed text-sm">
          {/* Section 1 */}
          <section className="rounded-xl border border-[#1A2235] bg-[#0F1524] p-6 sm:p-8">
            <h2 className="flex items-center gap-2 text-xl font-bold text-white mb-4">
              <Scale className="h-5 w-5 text-[#7C5CFF]" />
              1. Acceptance of Terms &amp; Third-Party Services
            </h2>
            <p className="text-slate-400 mb-3">
              By registering for, subscribing to, or accessing the ClipForge AI Video Automation platform, you agree to comply with and be bound by these Terms of Service.
            </p>
            <p className="text-slate-400">
              ClipForge relies on third-party API services, including Google &amp; YouTube API Services. By using ClipForge, you also explicitly agree to be bound by the{' '}
              <a
                href="https://www.youtube.com/t/terms"
                target="_blank"
                rel="noopener noreferrer"
                className="text-[#00D4FF] hover:underline"
              >
                YouTube Terms of Service
              </a>{' '}
              and{' '}
              <a
                href="https://policies.google.com/privacy"
                target="_blank"
                rel="noopener noreferrer"
                className="text-[#00D4FF] hover:underline"
              >
                Google Privacy Policy
              </a>.
            </p>
          </section>

          {/* Section 2 */}
          <section className="rounded-xl border border-[#1A2235] bg-[#0F1524] p-6 sm:p-8">
            <h2 className="flex items-center gap-2 text-xl font-bold text-white mb-4">
              <CreditCard className="h-5 w-5 text-[#7C5CFF]" />
              2. Subscriptions, Payments &amp; No-Refund Policy
            </h2>
            <div className="space-y-4">
              <div>
                <h3 className="font-semibold text-white mb-1">A. Billing &amp; Subscription Terms</h3>
                <p className="text-slate-400">
                  ClipForge offers Free, Basic, Pro, and Premium subscription plans. Paid tiers are billed in advance on a recurring billing cycle (monthly or annual).
                </p>
              </div>
              <div>
                <h3 className="font-semibold text-white mb-1">B. Absolute No Refunds</h3>
                <p className="text-slate-400">
                  Due to the immediate provisioning of AI compute resources, cloud rendering infrastructure, and API quotas upon payment: <strong className="text-white">ALL PAYMENTS AND SUBSCRIPTION UPGRADES ARE FINAL AND NON-REFUNDABLE</strong>. No partial refunds, prorated credits, or cash refunds will be provided for unused subscription periods, accidental upgrades, or account cancellations.
                </p>
              </div>
              <div>
                <h3 className="font-semibold text-white mb-1">C. Subscription Cancellation</h3>
                <p className="text-slate-400">
                  You may cancel auto-renewal for your subscription at any time through your account settings or billing management page. Your subscription will remain active until the end of your current paid billing period.
                </p>
              </div>
            </div>
          </section>

          {/* Section 3 */}
          <section className="rounded-xl border border-[#1A2235] bg-[#0F1524] p-6 sm:p-8">
            <h2 className="flex items-center gap-2 text-xl font-bold text-white mb-4">
              <Ban className="h-5 w-5 text-[#7C5CFF]" />
              3. User Conduct, Acceptable Use &amp; Immediate Termination
            </h2>
            <p className="text-slate-400 mb-4">
              You agree to use ClipForge strictly for lawful purposes. You are expressly prohibited from engaging in any of the following activities:
            </p>
            <ul className="list-disc pl-5 space-y-2 text-slate-400 mb-6">
              <li>Generating or uploading content that is illegal, defamatory, hate speech, violent, harassing, or sexually explicit.</li>
              <li>Violating third-party copyrights, trademarks, or intellectual property rights.</li>
              <li>Engaging in automated spamming, misleading metadata manipulation, or violating YouTube Community Guidelines.</li>
              <li>Attempting to reverse engineer, hack, bypass daily upload limits, exploit system vulnerabilities, or overload ClipForge infrastructure.</li>
              <li>Creating multiple free accounts to circumvent plan restrictions or system quotas.</li>
            </ul>
            <div className="rounded-lg border border-red-500/20 bg-red-500/10 p-4">
              <h3 className="flex items-center gap-2 font-bold text-rose-300 mb-1 text-xs uppercase tracking-wider">
                <AlertTriangle className="h-4 w-4 text-rose-400" />
                Account Termination &amp; Ban Enforcements
              </h3>
              <p className="text-xs text-slate-300">
                ClipForge reserves the absolute right to immediately suspend, terminate, or permanently ban any account found in violation of these Terms or engaged in abusive conduct. Banned users immediately lose access to all platform features, stored media, and connected YouTube automations without entitlement to any refund.
              </p>
            </div>
          </section>

          {/* Section 4 */}
          <section className="rounded-xl border border-[#1A2235] bg-[#0F1524] p-6 sm:p-8">
            <h2 className="flex items-center gap-2 text-xl font-bold text-white mb-4">
              <FileText className="h-5 w-5 text-[#7C5CFF]" />
              4. Content Ownership &amp; AI Disclaimer
            </h2>
            <p className="text-slate-400 mb-3">
              You retain ownership of original text prompts and custom media files uploaded to ClipForge.
            </p>
            <p className="text-slate-400">
              AI-generated scripts and videos are generated using machine learning models (Gemini AI). You are responsible for reviewing all generated content prior to publishing on YouTube to ensure compliance with YouTube policies and local regulations.
            </p>
          </section>

          {/* Section 5 */}
          <section className="rounded-xl border border-[#1A2235] bg-[#0F1524] p-6 sm:p-8">
            <h2 className="flex items-center gap-2 text-xl font-bold text-white mb-4">
              <Shield className="h-5 w-5 text-[#7C5CFF]" />
              5. Limitation of Liability &amp; Disclaimers
            </h2>
            <p className="text-slate-400 mb-3">
              ClipForge is provided on an <strong className="text-white">&quot;AS IS&quot; and &quot;AS AVAILABLE&quot;</strong> basis without warranties of any kind, whether express or implied.
            </p>
            <p className="text-slate-400">
              In no event shall ClipForge, its owners, or developers be liable for any indirect, incidental, special, or consequential damages resulting from channel suspensions by YouTube, API downtime, lost profits, or data loss arising out of your use of the service.
            </p>
          </section>

          {/* Section 6 */}
          <section className="rounded-xl border border-[#1A2235] bg-[#0F1524] p-6 sm:p-8">
            <h2 className="flex items-center gap-2 text-xl font-bold text-white mb-4">
              <HelpCircle className="h-5 w-5 text-[#7C5CFF]" />
              6. Contact Information
            </h2>
            <p className="text-slate-400">
              For any legal inquiries, support requests, or terms clarification, please contact:
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
