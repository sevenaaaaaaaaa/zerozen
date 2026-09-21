// 内容脚本专用的中英词典（会注入每个页面，只放页面内会出现的文案）
// key 是代码里的中文原文，$1/$2 为占位符。新增文案后运行 `npm run check` 检查缺漏。
globalThis.ZZ_DICT_EN = Object.assign(globalThis.ZZ_DICT_EN || {}, {
  // 启发式检测给出的命中理由
  "class/id 广告特征": "ad-like class/id",
  "标签：$1": "label: $1",
  "data 广告属性：$1": "data ad attribute: $1",
  "data 标签：$1": "data label: $1",
  "广告联盟 iframe：$1": "ad-network iframe: $1",
  "站外 iframe：$1": "third-party iframe: $1",
  "空白 iframe": "blank iframe",
  "文本标签：$1": "text label: $1",
  "诱导文案：$1": "bait text: $1",
  "站外下载链接：$1": "off-site download link: $1",
  "全屏浮层": "full-screen overlay",
  "悬浮层": "floating layer",
  "高层遮罩": "high z-index mask",

  // 页面内工具条
  "无法遍历文档": "Cannot walk the document",
  "没有可高亮的元素": "No elements to highlight",
  "元素不可见或已移除": "Element is hidden or already removed",
  "ZeroZen 发现 $1 处疑似广告": "ZeroZen found $1 likely ads",
  "全部屏蔽": "Block all",
  "去确认": "Review",
  "已屏蔽": "Blocked",
  "ZeroZen 已拦截弹窗": "ZeroZen blocked a popup",
  "（本页 $1 次）": " ($1 on this page)",

  // 元素选取器
  "(无法生成唯一选择器)": "(no unique selector available)",
  "屏蔽元素": "Block element",
  "应用到所有网站（通用规则）": "Apply to all sites (generic rule)",
  "隐藏": "Hide",
  "移除": "Remove",
  "应用": "Apply",
  "在此站放行同类元素": "Allow this kind of element on this site",
  "取消": "Cancel",
  "该元素没有可复用的通用选择器": "This element has no reusable generic selector",
  "所有网站": "all sites",
  "选择器无效": "invalid selector",
  "当前不匹配任何元素（仍可保存规则）": "Matches nothing right now (you can still save the rule)",
  "将影响 $1 个元素 · 作用范围：$2": "Affects $1 elements · scope: $2",
  "已添加屏蔽规则": "Blocking rule added",
  "添加失败：$1": "Could not add: $1",
  "未知错误": "unknown error",
  "已放行": "Allowed",
  "操作失败：$1": "Action failed: $1",
  "请填写选择器": "Enter a selector",
  "选择器语法无效": "Invalid selector syntax",
  "选择器匹配 $1 个元素，范围过大，请调整": "Selector matches $1 elements — too broad, narrow it down",
  "通用规则匹配元素过多，请缩小范围": "A generic rule matching this many elements is too broad",
  "已取消元素选取": "Element picker cancelled",

  // 反拦截回落提示
  "ZeroZen：检测到反广告拦截，已自动切换为兼容档": "ZeroZen: anti-adblock detected, switched to Compatible mode",
  "ZeroZen：本站反拦截较强，已临时放行 $1 分钟": "ZeroZen: strong anti-adblock here, paused for $1 minutes",

  // 阅读模式
  "未找到正文内容": "No article content found",
  "阅读模式采用<b>诚实付费</b>：觉得好用请支持作者":
    "Reader mode runs on the <b>honour system</b>: if you find it useful, support the author",
  "保存到本地": "Save to disk",
  "退出阅读模式": "Exit reader mode",
  "已提取 $1 字": "$1 characters extracted",
  "保存中…": "Saving…",
  "来源：$1": "Source: $1",
  "已保存：$1": "Saved: $1",
  "保存失败：$1": "Save failed: $1",

  // 视频嗅探来源
  "媒体元素": "media element",
  "网络请求": "network request",
  "页面脚本": "page script",
  "页面源码": "page source",
  "页面链接": "page link",
  "内嵌页面": "embedded frame",
  "已净化本页": "Page cleaned",
});
