chrome.commands.onCommand.addListener((command) => {
    if (command === "open_search") {
        // 可以在这里实现打开侧边栏，或者向content script发送消息打开搜索框
        console.log("快捷键触发");
        // 简单实现：打开选项页面作为搜索入口
        chrome.runtime.openOptionsPage(); 
    }
});