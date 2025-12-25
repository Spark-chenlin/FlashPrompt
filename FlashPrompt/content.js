let prompts = [];
let activeElement = null;
let savedRange = null; 
let menuElement = null;
let matchString = ''; 

// 初始化
initialize();

function initialize() {
    createMenuDOM();
    chrome.storage.onChanged.addListener((changes) => { if (changes.prompts) syncPrompts(); });
    syncPrompts();
    
    document.addEventListener('input', handleInput, true);
    document.addEventListener('keydown', handleKeydown, true);
    
    document.addEventListener('click', (e) => {
        if (menuElement && menuElement.style.display === 'block') {
            if (!menuElement.contains(e.target) && e.target !== activeElement) hideMenu();
        }
    });
}

function syncPrompts() { 
    chrome.storage.local.get({ prompts: [] }, (res) => { prompts = res.prompts; }); 
}

function createMenuDOM() {
    menuElement = document.createElement('div');
    menuElement.id = 'flash-prompt-menu';
    document.body.appendChild(menuElement);
}

// --- 1. 触发逻辑 ---
function handleInput(e) {
    const target = e.target;
    // 支持 input, textarea 和 contenteditable div
    const editable = target.closest('[contenteditable="true"], input, textarea');
    if (!editable) return;

    activeElement = editable;
    const text = getValue(activeElement);
    if (!text) { hideMenu(); return; } 

    const cursorPosition = getCursorPosition(activeElement);
    const textBeforeCursor = text.slice(0, cursorPosition);
    const lastSlashIndex = textBeforeCursor.lastIndexOf('/');
    
    if (lastSlashIndex === -1) { hideMenu(); return; }

    matchString = textBeforeCursor.slice(lastSlashIndex + 1);

    // 如果包含空格、换行符，说明可能不是指令，隐藏菜单
    if (matchString.includes(' ') || matchString.includes('\n') || matchString.includes('\t')) {
        hideMenu();
        return;
    }

    showMenu(activeElement, matchString);
}

// --- 2. 菜单渲染 ---
function showMenu(target, filterText) {
    const filterLower = filterText.toLowerCase();
    
    let filtered = prompts.filter(p => {
        const matchTitle = p.title.toLowerCase().includes(filterLower);
        const matchTags = (p.tags || []).some(t => t.toLowerCase().includes(filterLower));
        return matchTitle || matchTags;
    });
    
    if (filtered.length === 0) { hideMenu(); return; }

    // 排序逻辑：最近使用 > 收藏 > 其他
    let lastUsedPrompt = null;
    let maxTime = 0;
    filtered.forEach(p => {
        if (p.lastUsed && p.lastUsed > maxTime) {
            maxTime = p.lastUsed;
            lastUsedPrompt = p;
        }
    });

    const favorites = [];
    const others = [];

    filtered.forEach(p => {
        if (lastUsedPrompt && p.id === lastUsedPrompt.id) return;
        if (p.isFavorite) favorites.push(p);
        else others.push(p);
    });

    favorites.sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
    others.sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));

    const finalSort = [];
    if (lastUsedPrompt) finalSort.push(lastUsedPrompt);
    finalSort.push(...favorites);
    finalSort.push(...others);

    // 渲染 DOM
    menuElement.innerHTML = '';
    finalSort.forEach((p, index) => {
        const div = document.createElement('div');
        div.className = `menu-item ${index === 0 ? 'selected' : ''}`;
        const tagsHtml = (p.tags || []).slice(0, 2).map(t => `<span class="menu-tag">${t}</span>`).join('');
        
        div.innerHTML = `
            <div style="display:flex;align-items:center;gap:6px">
                <span class="menu-title">/${p.title}</span>
                ${tagsHtml}
            </div>
            <span class="menu-preview">${p.content}</span>
        `;
        div.onmousedown = (e) => { e.preventDefault(); selectPrompt(p); };
        menuElement.appendChild(div);
    });

    // 定位菜单
    const rect = target.getBoundingClientRect();
    const scrollTop = window.pageYOffset || document.documentElement.scrollTop;
    const scrollLeft = window.pageXOffset || document.documentElement.scrollLeft;
    
    menuElement.style.display = 'block';
    // 简单定位在元素上方，如果需要更精细的光标跟随定位，需要更复杂的逻辑
    menuElement.style.top = `${scrollTop + rect.top - menuElement.offsetHeight - 5}px`;
    menuElement.style.left = `${scrollLeft + rect.left}px`;
}

function hideMenu() { if(menuElement) menuElement.style.display = 'none'; }

// --- 3. 键盘导航 ---
function handleKeydown(e) {
    if (!menuElement || menuElement.style.display === 'none') return;

    const items = menuElement.querySelectorAll('.menu-item');
    if (items.length === 0) return;

    let selectedIndex = -1;
    items.forEach((item, index) => { if(item.classList.contains('selected')) selectedIndex = index; });

    if (e.key === 'ArrowDown') {
        e.preventDefault();
        const nextIndex = (selectedIndex + 1) % items.length;
        updateSelection(items, nextIndex);
    } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        const prevIndex = (selectedIndex - 1 + items.length) % items.length;
        updateSelection(items, prevIndex);
    } else if (e.key === 'Enter' || e.key === 'Tab') {
        // 阻止默认回车换行，执行选中
        e.preventDefault();
        e.stopPropagation();
        if (selectedIndex !== -1 && items[selectedIndex]) {
            items[selectedIndex].onmousedown(e);
        }
    } else if (e.key === 'Escape') {
        hideMenu();
    }
}

function updateSelection(items, index) {
    items.forEach(item => item.classList.remove('selected'));
    items[index].classList.add('selected');
    items[index].scrollIntoView({ block: 'nearest' });
}

// --- 4. 选中逻辑 (修复多变量多余 "/" 的核心) ---
function selectPrompt(prompt) {
    hideMenu();
    updateLastUsed(prompt.id);

    // 【核心修复】先删除触发词（例如 "/fix"），再处理后续逻辑。
    // 这样无论是有变量还是无变量，后续只管插入纯净的文本，不会有残留符号。
    deleteTriggerText();

    const variables = prompt.content.match(/{{(.*?)}}/g);
    if (variables) {
        // 保存当前光标位置（此时已删除了触发词），以便弹窗关闭后插入
        saveCurrentSelection(); 
        openVariableModal(prompt); 
    } else {
        // 无变量，直接插入内容
        insertPureText(prompt.content);
    }
}

// 删除光标前的触发指令 (例如 /abc)
function deleteTriggerText() {
    if (!activeElement) return;

    const currentVal = getValue(activeElement);
    const cursorPos = getCursorPosition(activeElement);
    const beforeCursor = currentVal.slice(0, cursorPos);
    const lastSlash = beforeCursor.lastIndexOf('/');
    
    if (lastSlash === -1) return;

    // 要删除的字符数：从 / 开始到光标位置
    const deleteCount = cursorPos - lastSlash;

    // 执行删除
    if (document.queryCommandSupported('delete')) {
        for(let i=0; i<deleteCount; i++) document.execCommand('delete', false, null);
    } else {
        // fallback logic
        const val = activeElement.value;
        if (val !== undefined) {
             const newVal = val.slice(0, lastSlash) + val.slice(cursorPos);
             activeElement.value = newVal;
             // 恢复光标位置到删除处
             activeElement.setSelectionRange(lastSlash, lastSlash);
        }
    }
}

function updateLastUsed(id) {
    const now = Date.now();
    const updatedPrompts = prompts.map(p => {
        if (p.id === id) return { ...p, lastUsed: now };
        return p;
    });
    chrome.storage.local.set({ prompts: updatedPrompts });
}

// --- 5. 变量弹窗 (功能增强版) ---
function openVariableModal(prompt) {
    const modal = document.createElement('div');
    modal.id = 'flash-variable-modal';
    
    // 统计总变量数
    const totalVars = (prompt.content.match(/{{(.*?)}}/g) || []).length;
    
    // 高亮变量预览
    let previewContent = prompt.content.replace(/{{(.*?)}}/g, '<span class="var-highlight">{{$1}}</span>');

    modal.innerHTML = `
        <div class="modal-box">
            <h3 style="margin-top:0;margin-bottom:15px; font-size:18px;">⚡️ 完善变量</h3>
            
            <div class="prompt-preview-box">${previewContent}</div>

            <div class="input-area-wrapper">
                <textarea id="flash-batch-input" 
                       placeholder="在此输入... 格式: {{值1}}{{值2}}" 
                       rows="1"></textarea>
                <div id="var-counter-display" class="var-counter">已填 0 / ${totalVars}</div>
            </div>

            <div class="modal-footer">
                <span class="hint-text">Enter 提交 &nbsp;|&nbsp; Ctrl+Enter 换行</span>
                <button id="flash-insert-btn">插入内容</button>
            </div>
        </div>
    `;

    document.body.appendChild(modal);
    
    const inputEl = document.getElementById('flash-batch-input');
    const counterEl = document.getElementById('var-counter-display');

    // 自动聚焦
    inputEl.focus();

    // 核心：高度自适应 + 计数逻辑
    const handleInputResizeAndCount = () => {
        // 1. 自动高度
        inputEl.style.height = 'auto'; 
        inputEl.style.height = (inputEl.scrollHeight) + 'px';

        // 2. 变量计数
        const currentMatches = inputEl.value.match(/{{(.*?)}}/g);
        const filledCount = currentMatches ? currentMatches.length : 0;
        counterEl.innerText = `已填 ${filledCount} / ${totalVars}`;
        
        if(filledCount >= totalVars) counterEl.classList.add('completed');
        else counterEl.classList.remove('completed');
    };

    inputEl.addEventListener('input', handleInputResizeAndCount);

    // 提交逻辑
    const submit = () => {
        const rawInput = inputEl.value;
        const userMatches = rawInput.match(/{{(.*?)}}/g);
        
        if (!userMatches) {
            // 用户未按格式输入，直接关闭（或提示）
            modal.remove();
            restoreSelection();
            return;
        }

        const promptVars = prompt.content.match(/{{(.*?)}}/g);
        let finalContent = prompt.content;
        
        if (promptVars) {
            promptVars.forEach((pVar, index) => {
                if (userMatches[index]) {
                    const cleanValue = userMatches[index].replace(/^{{|}}$/g, '');
                    finalContent = finalContent.replace(pVar, cleanValue);
                }
            });
        }

        modal.remove();
        restoreSelection();
        // 延迟一点点确保焦点回来
        setTimeout(() => insertPureText(finalContent), 10);
    };

    document.getElementById('flash-insert-btn').onclick = submit;

    // 键盘监听：拦截 Enter
    inputEl.addEventListener('keydown', (e) => {
        e.stopPropagation(); // 防止冒泡到页面其他监听器
        
        if (e.key === 'Enter') {
            if (e.ctrlKey || e.metaKey || e.shiftKey) {
                // Ctrl+Enter / Shift+Enter -> 允许换行 (默认行为)
                return; 
            } else {
                // 单独 Enter -> 提交
                e.preventDefault();
                submit();
            }
        } else if (e.key === 'Escape') {
            modal.remove();
            restoreSelection();
        }
    });
}

// --- 6. 纯净插入文本 (不再负责删除) ---
function insertPureText(text) {
    if (!activeElement) return;
    activeElement.focus();

    let success = false;
    
    // 尝试使用 execCommand 插入 (兼容性好，支持撤销)
    if (document.queryCommandSupported('insertText')) {
        success = document.execCommand('insertText', false, text);
    }
    
    // 如果失败 (某些复杂编辑器)，使用手动赋值
    if (!success) {
        if (activeElement.value !== undefined) { // Input / Textarea
            const start = activeElement.selectionStart;
            const end = activeElement.selectionEnd;
            const val = activeElement.value;
            activeElement.value = val.slice(0, start) + text + val.slice(end);
            // 移动光标到插入内容之后
            activeElement.selectionStart = activeElement.selectionEnd = start + text.length;
        } else { // ContentEditable Div (fallback)
            const sel = window.getSelection();
            if (sel.rangeCount > 0) {
                const range = sel.getRangeAt(0);
                range.deleteContents();
                range.insertNode(document.createTextNode(text));
                range.collapse(false);
            }
        }
    }

    // 触发 input 事件，让网页知道内容变了 (适配 React/Vue 等框架)
    activeElement.dispatchEvent(new Event('input', { bubbles: true }));
    activeElement.dispatchEvent(new Event('change', { bubbles: true }));
}

// --- 辅助函数 ---
function saveCurrentSelection() {
    const sel = window.getSelection();
    if (sel.rangeCount > 0) savedRange = sel.getRangeAt(0).cloneRange();
}
function restoreSelection() {
    if (!activeElement) return;
    activeElement.focus();
    if (savedRange) {
        const sel = window.getSelection();
        sel.removeAllRanges();
        sel.addRange(savedRange);
    }
}
function getValue(el) {
    if (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA') return el.value;
    return el.innerText || el.textContent;
}
function getCursorPosition(el) {
    if (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA') return el.selectionStart;
    const selection = window.getSelection();
    if (selection.rangeCount > 0) {
        const range = selection.getRangeAt(0);
        const preCaretRange = range.cloneRange();
        preCaretRange.selectNodeContents(el);
        preCaretRange.setEnd(range.endContainer, range.endOffset);
        return preCaretRange.toString().length;
    }
    return 0;
}