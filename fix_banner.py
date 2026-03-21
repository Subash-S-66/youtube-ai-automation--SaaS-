import re

with open('frontend/src/components/layout/GlobalBanner.tsx', 'r') as f:
    content = f.read()

# Make the banner z-index slightly lower than the navbar if they were to intersect, or just lower than overlays.
# Navbar is 1000. Sidebar is 50. Overlays are 40.
# The banner should probably be at the very top (fixed top-0) but its z-index should be `z-[999]` so the sticky navbar `z-[1000]` can go over it if needed, or if an overlay modal (`z-[9999]`) is open, it obscures the banner.
# The prompt says: "Banner/alert component: Should NOT exceed navbar z-index".
content = content.replace(
    'className={`w-full font-medium overflow-hidden z-[100] fixed top-0 left-0 flex items-center shadow-md ${currentStyle}`}',
    'className={`w-full font-medium overflow-hidden z-[999] fixed top-0 left-0 flex items-center shadow-md ${currentStyle}`}'
)

with open('frontend/src/components/layout/GlobalBanner.tsx', 'w') as f:
    f.write(content)

print("Updated GlobalBanner.tsx")
