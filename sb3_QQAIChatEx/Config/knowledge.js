const knowledge = [
    "CQ码-约定格式:[CQ:类型,参数=值,参数=值]",
    "CQ码-使用:与普通消息一起发送，如：'[CQ:at,qq=10086]你好'，该断消息会被解析为：'@小明 你好'，除非特殊标注，大多CQ码都不能与普通消息一同发送",
    "CQ码-AT:[CQ:at,qq=QQ号/all,name=当找不到qq时使用该名称，可选参数]，可与文本消息共存",
    "CQ码-图片:[CQ:image,file=URL/base64,summary=说明文本，可选]，可与文本消息共存",
    "CQ码-语音:[CQ:record,file=URL/base64]",
    "CQ码-视频:[CQ:video,file=URL/base64]",
    "CQ码-猜拳魔法表情:[CQ:rps]",
    "CQ码-掷骰子魔法表情:[CQ:dice]",
    "CQ码-分享好友:[CQ:contact,type=qq,id=QQ号]",
    "CQ码-分享群聊:[CQ:contact,type=group,id=群号，群不存在时不显示]"
];


module.exports = (query, maxResults = 10) => {
    const keywords = query.trim().toLowerCase().split(/\s+/);
    if (keywords[0] === "all" && keywords.length === 1) return knowledge;
    if (keywords.length === 1 && keywords[0] === "") return ["请输入有效的搜索关键词"];

    // 使用 Set 去重 + 过滤 + 排序
    const results = knowledge
        .filter(doc => keywords.some(kw => doc.toLowerCase().includes(kw)))
        .sort((a, b) => {
            // 按匹配关键词数量排序（包含更多关键词的排前面）
            const aScore = keywords.filter(kw => a.toLowerCase().includes(kw)).length;
            const bScore = keywords.filter(kw => b.toLowerCase().includes(kw)).length;
            return bScore - aScore;
        });

    if (results.length === 0) return [];
    return maxResults === -1 ? results : results.slice(0, maxResults);
}
