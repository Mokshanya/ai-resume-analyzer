with open('e:/Downloads/resume website/style.css', 'r', encoding='utf-8', errors='ignore') as f:
    text = f.read()

index = text.find('.modal-iframe')
if index != -1:
    end_index = text.find('}', index) + 1
    new_text = text[:end_index] + '\n'
    with open('e:/Downloads/resume website/style.css', 'w', encoding='utf-8') as f:
        f.write(new_text)
    print("Fixed style.css")
else:
    print("Could not find .modal-iframe")
