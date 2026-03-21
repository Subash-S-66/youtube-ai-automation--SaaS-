import re

with open('frontend/src/app/payments/page.tsx', 'r') as f:
    content = f.read()

new_code = """              <div className="flex items-end mb-2">
                <span className="text-4xl font-extrabold text-white capitalize">{user?.plan}</span>
                <span className="text-sm text-slate-500 mb-1 ml-2">/ month</span>
              </div>
              {user?.cancelAtPeriodEnd && (
                 <div className="mt-2 inline-block px-3 py-1 bg-red-500/20 border border-red-500/30 text-red-400 text-xs font-bold rounded">
                   Cancels at Period End
                 </div>
              )}"""

content = re.sub(
    r'              <div className="flex items-end mb-2">\n                <span className="text-4xl font-extrabold text-white capitalize">\{user\?\.plan\}</span>\n                <span className="text-sm text-slate-500 mb-1 ml-2">/ month</span>\n              </div>',
    new_code,
    content,
    flags=re.DOTALL
)

with open('frontend/src/app/payments/page.tsx', 'w') as f:
    f.write(content)

print("Added cancel badge to payments UI")
