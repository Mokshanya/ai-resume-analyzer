import sys
import os

js_path = r'e:\Downloads\resume website\script.js'
html_path = r'e:\Downloads\resume website\index.html'

with open(js_path, 'r', encoding='utf-8') as f:
    js_lines = f.readlines()

new_js = []
skip_js = False
for line in js_lines:
    if line.strip() == '// Hide Form, Show Results':
        skip_js = True
        new_js.append('            // Store results in session and open new tab\n')
        new_js.append('            sessionStorage.setItem("analysisData", JSON.stringify(data));\n')
        new_js.append('            window.open("analysis-result.html", "_blank");\n')
        new_js.append('            leadForm.reset();\n')
        continue
    if skip_js and line.strip() == '// Re-initialize any new icons':
        skip_js = False
        new_js.append(line)
        continue
    if not skip_js:
        new_js.append(line)

with open(js_path, 'w', encoding='utf-8') as f:
    f.writelines(new_js)

with open(html_path, 'r', encoding='utf-8') as f:
    html_lines = f.readlines()

new_html = []
skip_html = False
for line in html_lines:
    if line.strip() == '<!-- Results Section (Initially Hidden) -->':
        skip_html = True
        continue
    if skip_html and line.strip() == '<!-- FAQ -->':
        skip_html = False
        new_html.append('    <!-- FAQ -->\n')
        continue
    if not skip_html:
        new_html.append(line)

with open(html_path, 'w', encoding='utf-8') as f:
    f.writelines(new_html)

print("Rewrite Complete")
