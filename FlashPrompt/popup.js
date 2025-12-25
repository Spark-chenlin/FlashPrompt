document.addEventListener('DOMContentLoaded', () => {
    // 基础 DOM
    const promptList = document.getElementById('promptList');
    const searchInput = document.getElementById('searchInput');
    const addBtn = document.getElementById('addBtn');
    
    // 1. 编辑/新建 模态框
    const modal = document.getElementById('modal');
    const closeModalBtn = document.getElementById('closeModalBtn');
    const saveBtn = document.getElementById('saveBtn');
    
    // 2. 标签管理 模态框
    const tagManagerBtn = document.getElementById('tagManagerBtn');
    const tagManagerModal = document.getElementById('tagManagerModal');
    const closeTagManagerBtn = document.getElementById('closeTagManagerBtn');
    const tagListManager = document.getElementById('tagListManager');
    const totalTagCount = document.getElementById('totalTagCount');

    // 3. 标签重命名 模态框
    const tagEditModal = document.getElementById('tagEditModal');
    const closeTagEditBtn = document.getElementById('closeTagEditBtn');
    const saveTagBtn = document.getElementById('saveTagBtn');
    const oldTagNameInput = document.getElementById('oldTagName');
    const newTagNameInput = document.getElementById('newTagNameInput');

    let allPrompts = []; 

    // 初始化
    loadData();

    // --- 事件绑定 ---
    addBtn.addEventListener('click', () => openPromptModal());
    closeModalBtn.addEventListener('click', () => modal.classList.add('hidden'));
    
    tagManagerBtn.addEventListener('click', () => {
        renderTagManager();
        tagManagerModal.classList.remove('hidden');
    });
    closeTagManagerBtn.addEventListener('click', () => tagManagerModal.classList.add('hidden'));

    closeTagEditBtn.addEventListener('click', () => tagEditModal.classList.add('hidden'));
    
    searchInput.addEventListener('input', (e) => renderPromptList(e.target.value));
    saveBtn.addEventListener('click', savePrompt);
    saveTagBtn.addEventListener('click', saveTagRename);

    // --- 数据加载 ---
    function loadData() {
        chrome.storage.local.get({ prompts: [] }, (result) => {
            allPrompts = result.prompts;
            renderPromptList();
        });
    }

    // --- 渲染提示词列表 (保持之前逻辑) ---
    function renderPromptList(filter = '') {
        promptList.innerHTML = '';
        const filterLower = filter.toLowerCase();
        
        let filtered = allPrompts.filter(p => {
            const inTitle = p.title.toLowerCase().includes(filterLower);
            const inContent = p.content.toLowerCase().includes(filterLower);
            const inTags = (p.tags || []).some(t => t.toLowerCase().includes(filterLower));
            return inTitle || inContent || inTags;
        });

        filtered.sort((a, b) => (b.isFavorite ? 1 : 0) - (a.isFavorite ? 1 : 0) || (b.updatedAt || 0) - (a.updatedAt || 0));

        filtered.forEach(p => {
            const li = document.createElement('li');
            const tagsHtml = (p.tags || []).map(t => `<span class="tag-badge">${t}</span>`).join('');
            const starClass = p.isFavorite ? 'active' : '';
            const starIcon = p.isFavorite ? '★' : '☆';

            li.innerHTML = `
                <div class="item-content">
                    <div class="item-title">/${p.title}</div>
                    <div class="item-preview">${p.content}</div>
                    <div class="tags-container">${tagsHtml}</div>
                </div>
                <span class="fav-btn ${starClass}">${starIcon}</span>
                <span class="delete-btn">删除</span>
            `;

            li.querySelector('.item-content').addEventListener('click', () => openPromptModal(p));
            li.querySelector('.fav-btn').addEventListener('click', (e) => { e.stopPropagation(); toggleFavorite(p.id); });
            li.querySelector('.delete-btn').addEventListener('click', (e) => { e.stopPropagation(); deletePrompt(p.id); });
            
            promptList.appendChild(li);
        });
    }

    // --- 渲染标签管理列表 ---
    function renderTagManager() {
        tagListManager.innerHTML = '';
        const tagMap = {};
        allPrompts.forEach(p => {
            (p.tags || []).forEach(t => { tagMap[t] = (tagMap[t] || 0) + 1; });
        });

        const tags = Object.keys(tagMap).sort();
        totalTagCount.innerText = tags.length;

        if (tags.length === 0) {
            tagListManager.innerHTML = '<div style="text-align:center;color:#999;padding:20px;">暂无标签</div>';
            return;
        }

        tags.forEach(tag => {
            const li = document.createElement('li');
            li.className = 'tag-row';
            li.innerHTML = `
                <div class="tag-info">
                    <span class="tag-pill">${tag}</span>
                    <span style="font-size:12px;color:#999;margin-left:5px">(${tagMap[tag]})</span>
                </div>
                <button class="edit-tag-btn">重命名</button>
            `;
            li.querySelector('.edit-tag-btn').addEventListener('click', () => {
                oldTagNameInput.value = tag;
                newTagNameInput.value = tag;
                tagEditModal.classList.remove('hidden');
                newTagNameInput.focus();
            });
            tagListManager.appendChild(li);
        });
    }

    // --- 保存逻辑 ---
    function savePrompt() {
        const title = document.getElementById('promptTitle').value.trim();
        const content = document.getElementById('promptContent').value.trim();
        const tagsStr = document.getElementById('promptTags').value.trim();
        const id = document.getElementById('editId').value;
        
        if (!title || !content) return;
        const tags = tagsStr ? tagsStr.split(/[,，]/).map(t => t.trim()).filter(t => t) : [];

        if (id) {
            const idx = allPrompts.findIndex(p => p.id === id);
            if (idx !== -1) allPrompts[idx] = { ...allPrompts[idx], title, content, tags, updatedAt: Date.now() };
        } else {
            allPrompts.push({ id: crypto.randomUUID(), title, content, tags, isFavorite: false, createdAt: Date.now() });
        }

        chrome.storage.local.set({ prompts: allPrompts }, () => {
            modal.classList.add('hidden');
            renderPromptList();
        });
    }

    function saveTagRename() {
        const oldName = oldTagNameInput.value;
        const newName = newTagNameInput.value.trim();
        
        if (newName && newName !== oldName) {
            allPrompts.forEach(p => {
                if (p.tags && p.tags.includes(oldName)) {
                    p.tags = p.tags.map(t => t === oldName ? newName : t);
                    p.tags = [...new Set(p.tags)]; 
                }
            });
            chrome.storage.local.set({ prompts: allPrompts }, () => {
                tagEditModal.classList.add('hidden');
                renderTagManager(); // 刷新标签列表
                renderPromptList(searchInput.value); // 刷新主列表
            });
        } else {
            tagEditModal.classList.add('hidden');
        }
    }

    function deletePrompt(id) {
        if(!confirm('删除?')) return;
        allPrompts = allPrompts.filter(p => p.id !== id);
        chrome.storage.local.set({ prompts: allPrompts }, () => renderPromptList(searchInput.value));
    }

    function toggleFavorite(id) {
        const p = allPrompts.find(p => p.id === id);
        if(p) { p.isFavorite = !p.isFavorite; chrome.storage.local.set({ prompts: allPrompts }, () => renderPromptList(searchInput.value)); }
    }

    function openPromptModal(p = null) {
        modal.classList.remove('hidden');
        if (p) {
            document.getElementById('promptTitle').value = p.title;
            document.getElementById('promptContent').value = p.content;
            document.getElementById('promptTags').value = (p.tags || []).join(', ');
            document.getElementById('editId').value = p.id;
        } else {
            document.getElementById('promptTitle').value = '';
            document.getElementById('promptContent').value = '';
            document.getElementById('promptTags').value = '';
            document.getElementById('editId').value = '';
        }
    }
});