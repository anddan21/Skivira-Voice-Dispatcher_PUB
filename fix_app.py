import re

with open('skivira-bot/skivira-server/Public/chat/app.js', 'r', encoding='utf-8') as f:
    content = f.read()

content = content.replace('// <-- ВАЖНО: обрабатывается скриптом viewport-fix.js */', '// <-- IMPORTANT: processed by viewport-fix.js script */')

with open('skivira-bot/skivira-server/Public/chat/app.js', 'w', encoding='utf-8') as f:
    f.write(content)

with open('skivira-bot/skivira-server/Public/call/app.js', 'r', encoding='utf-8') as f:
    content = f.read()

content = content.replace('// <-- ВАЖНО: обрабатывается скриптом viewport-fix.js */', '// <-- IMPORTANT: processed by viewport-fix.js script */')

with open('skivira-bot/skivira-server/Public/call/app.js', 'w', encoding='utf-8') as f:
    f.write(content)
