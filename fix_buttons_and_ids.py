import re

# 1. Fix admin/page.tsx planValueMap duplicate IDs
filepath = 'frontend/src/app/admin/page.tsx'
with open(filepath, 'r') as f:
    content = f.read()

# Replace id="plan-value-map" with id={`plan-value-map-${key}`}
content = content.replace('id="plan-value-map"', 'id={`plan-value-map-${key}`}')

# Fix delete button missing aria-label
content = content.replace('<button onClick={() => handleDeleteUser(u._id)}', '<button aria-label={`Delete user ${u.email}`} onClick={() => handleDeleteUser(u._id)}')
content = content.replace('<button\n                        onClick={() => handleDeleteTicket(ticket._id)}', '<button\n                        aria-label={`Delete ticket ${ticket.subject}`}\n                        onClick={() => handleDeleteTicket(ticket._id)}')

with open(filepath, 'w') as f:
    f.write(content)

# 2. Fix media/page.tsx max-videos duplicate IDs and button aria-labels
filepath = 'frontend/src/app/media/page.tsx'
with open(filepath, 'r') as f:
    content = f.read()

# I see max-videos-per-day isn't actually in a loop in media/page.tsx, it's global for the channel connection. Let's verify.
# Ah, but there might be multiple channel connections? No, it's just one input. Let me check the file content.
# Wait, let's fix delete buttons in media/page.tsx
content = content.replace('<button onClick={() => handleDelete(v._id)} className="absolute top-2 right-2', '<button aria-label={`Delete video ${v.originalName}`} onClick={() => handleDelete(v._id)} className="absolute top-2 right-2')
content = content.replace('<button onClick={() => handleDelete(img._id)} className="absolute top-2 right-2', '<button aria-label={`Delete image ${img.originalName}`} onClick={() => handleDelete(img._id)} className="absolute top-2 right-2')

with open(filepath, 'w') as f:
    f.write(content)

# 3. Fix dashboard/page.tsx missing button aria-labels
filepath = 'frontend/src/app/dashboard/page.tsx'
with open(filepath, 'r') as f:
    content = f.read()

content = content.replace('<button onClick={handleRemoveCustomMedia}', '<button aria-label="Remove Custom Media" onClick={handleRemoveCustomMedia}')
content = content.replace('<button onClick={handleRemoveThumbnail}', '<button aria-label="Remove Thumbnail" onClick={handleRemoveThumbnail}')
content = content.replace('<button type="button" onClick={(e) => playVoicePreview(e, voice.name)}', '<button aria-label={`Play preview for voice ${voice.name}`} type="button" onClick={(e) => playVoicePreview(e, voice.name)}')
content = content.replace('<button\n                                onClick={() => document.getElementById(\'thumbnail-upload\')?.click()}', '<button\n                                aria-label="Upload Thumbnail"\n                                onClick={() => document.getElementById(\'thumbnail-upload\')?.click()}')

with open(filepath, 'w') as f:
    f.write(content)
