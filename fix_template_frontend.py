import re

with open('frontend/src/app/dashboard/page.tsx', 'r') as f:
    content = f.read()

# Add states for template
state_adds = """  const [randomVoice, setRandomVoice] = usePersistentSettings<boolean>('clipforge_randomVoice', true);
  const [templateFont, setTemplateFont] = usePersistentSettings<string>('clipforge_templateFont', 'Arial');
  const [templateColor, setTemplateColor] = usePersistentSettings<string>('clipforge_templateColor', '#FFFFFF');"""

content = content.replace("  const [randomVoice, setRandomVoice] = usePersistentSettings<boolean>('clipforge_randomVoice', true);", state_adds)

# Update payload
payload_adds = """        ctaEnabled,
        voices: finalVoices,
        templateConfig: user?.plan === 'premium' ? { fontStyle: templateFont, subtitleColor: templateColor } : undefined
      }, acceptedWarning);"""

content = content.replace("        ctaEnabled,\n        voices: finalVoices\n      }, acceptedWarning);", payload_adds)

# Add UI
ui_adds = """              {/* Call to Actions & Voices */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">

                {user?.plan === 'premium' && (
                  <div className="col-span-1 sm:col-span-2 bg-[#0B0F1A] p-4 rounded-xl border border-[#00D4FF]/30 space-y-4">
                     <div className="flex items-center mb-2">
                       <Sparkles className="h-4 w-4 text-[#00D4FF] mr-2" />
                       <h3 className="text-sm font-semibold text-white">Premium Template Config</h3>
                     </div>
                     <div className="grid grid-cols-2 gap-4">
                       <div>
                         <label className="text-xs text-slate-400 mb-1 block">Font Style</label>
                         <select value={templateFont} onChange={(e) => setTemplateFont(e.target.value)} className="w-full bg-[#111827] text-slate-300 text-sm border border-[#1A2235] rounded-lg p-2 focus:outline-none focus:border-[#00D4FF]">
                           <option value="Arial">Arial</option>
                           <option value="Anton">Anton</option>
                           <option value="Montserrat">Montserrat</option>
                           <option value="Bebas Neue">Bebas Neue</option>
                         </select>
                       </div>
                       <div>
                         <label className="text-xs text-slate-400 mb-1 block">Subtitle Color</label>
                         <input type="color" value={templateColor} onChange={(e) => setTemplateColor(e.target.value)} className="w-full h-9 bg-[#111827] border border-[#1A2235] rounded-lg p-1 cursor-pointer" />
                       </div>
                     </div>
                  </div>
                )}
"""

content = content.replace("              {/* Call to Actions & Voices */}\n              <div className=\"grid grid-cols-1 sm:grid-cols-2 gap-4\">", ui_adds)

with open('frontend/src/app/dashboard/page.tsx', 'w') as f:
    f.write(content)

print("Updated dashboard with template customization")
