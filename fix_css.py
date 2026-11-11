import re

with open('skivira-bot/skivira-server/Public/call/main.css', 'r', encoding='utf-8') as f:
    content = f.read()

replacements = [
    (r"/\* <- Fallback-высота \*/", "/* <- Fallback height */"),
    (r"/\* <-- ВОЗВРАЩАЕМ 'auto'\. JavaScript теперь сам задает высоту\. \*/", "/* <-- RETURNING 'auto'. JavaScript now sets the height itself. */"),
    (r"/\* align-content: end; <-- УДАЛЯЕМ\. 'app\.js' \(scrollTop\) управляет прокруткой\. \*/", "/* align-content: end; <-- REMOVING. 'app.js' (scrollTop) manages scrolling. */"),
    (r"/\* <-- ИЗМЕНЕНИЕ \(было 118px\) \*/", "/* <-- CHANGE (was 118px) */"),
    (r"/\* <-- ИЗМЕНЕНИЕ \(было 104px\) \*/", "/* <-- CHANGE (was 104px) */")
]

for old, new_ in replacements:
    content = re.sub(old, new_, content)

with open('skivira-bot/skivira-server/Public/call/main.css', 'w', encoding='utf-8') as f:
    f.write(content)
