import re

with open('frontend/src/components/layout/DashboardLayout.tsx', 'r') as f:
    content = f.read()

# Make the header sticky to the top, so it scrolls properly and has a reliable z-index.
# The `body.has-global-banner` applies padding-top 40px, so if we use `sticky top-0 z-[1000]`, the header will sit nicely beneath the banner and above content.
# The sidebar overlay uses z-40, sidebar uses z-50.
# We should give the header `sticky top-0 z-[1000]`.

content = content.replace(
    '<header className="h-16 flex-shrink-0 bg-[#111827]/80 backdrop-blur-xl border-b border-[#1A2235] flex items-center justify-between px-4 sm:px-6 lg:px-8 z-10">',
    '<header className="sticky top-0 h-16 flex-shrink-0 bg-[#111827]/80 backdrop-blur-xl border-b border-[#1A2235] flex items-center justify-between px-4 sm:px-6 lg:px-8 z-[1000]">',
)

with open('frontend/src/components/layout/DashboardLayout.tsx', 'w') as f:
    f.write(content)

print("Updated DashboardLayout.tsx header")
