import Link from 'next/link';
import { indexedPageLinks } from '../../lib/seo';

export default function SiteNavigation() {
  return (
    <footer className="border-t border-[#1A2235] bg-[#0B0F1A]/95">
      <div className="mx-auto max-w-6xl px-4 py-6 md:px-8">
        <nav aria-label="ClipForge site navigation" className="flex flex-wrap items-center gap-2 md:gap-3">
          {indexedPageLinks.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              aria-label={`Navigate to ${item.label}`}
              className="rounded-full border border-[#32507A] px-3 py-1.5 text-xs font-semibold text-[#9DDCFF] transition hover:border-[#00D4FF] hover:text-white md:text-sm"
            >
              {item.label}
            </Link>
          ))}
        </nav>
      </div>
    </footer>
  );
}
