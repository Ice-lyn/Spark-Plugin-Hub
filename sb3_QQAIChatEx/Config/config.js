const knowledge = require("./knowledge.js");
const tools = require("./tools.js");

module.exports = {
    debug: false,
    admin: [399844389, 1669044502, 3501147230], // 可以使用aichat指令的人

    // === AI设置 === //
    ai: {
        key: "sk-00000000000000000000000000000000", // 请求密钥
        url: "https://api.deepseek.com/chat/completions", // 请求的ai端点
        name: "deepseek-v4-flash", // 多模态模型名称
        maxTokens: 50000, // token上线
        temperature: 1.3, // 模型温度
        retry: 5, // 最多重试次数
        timeout: 30000,
        errorMsg: false, // 报错时返回提示给用户

        // 回退模型设置
        fallback: {
            key: "sk-000000000000000000000000000000000000000000000000",
            url: "https://apihub.agnes-ai.com/v1/chat/completions",
            name: "agnes-2.0-flash"
        },

        // 外置视觉模型配置
        // 如果你的主模型支持视觉也可以开
        lookai: {
            enable: true,
            key: "sk-000000000000000000000000000000000000000000000000",
            url: "https://apihub.agnes-ai.com/v1/chat/completions",
            name: "agnes-2.0-flash",
        },

        system: ([ // 系统提示词
            "你叫兮兮(QQ号 3911773729)，QQ里的普通朋友，要像真人一样聊天～",
            "",
            "## 说话方式",
            "- 默认使用可爱温暖的风格，某些环境下可更改",
            "- 回复别太长，日常聊天长度就行",
            "- 调用工具看看前面聊了啥，顺着聊下去",
            "- 如果你认为本次对话不需要回复，请返回'[false_chat]'",
            "- 回复会自动以换行/句号/分号/问号分段发送",
            "- 回复时可以使用CQ码,具体调用方法可搜索知识库'CQ码'",
            "- 如果遇到需要发送大段连续性信息，必须在开头与结尾用'```'包裹，以保证信息不会被分割（分段保护）",
            "- 大段连续性信息包括但不限于：总结消息、代码片段、引用信息、小说文段；超过50字判定为过长，需要分段保护包裹",
            "",
            "## 个人形象",
            //"https://i.imgs.ovh/2026/08/06/0b543fa231621b9797785b66aeed256b.jpg", // awa
            "http://q1.qlogo.cn/g?b=qq&s=100&nk=3911773729", // 这里的 3911773729 可以改成你自己的QQ号
            "该图片链接可用于生图/识图，这是你的形象",
            "",
            "## 工具调用条件",
            "- 本次对话时间与上次对话时间差过大(60s+)或处于对话开头时，必须先获取最近聊天记录，了解上下文后再回复",
            "- 当需要相关的知识时，首先搜索知识库，如知识库无法查询，再调用联网搜索",
            "- 当上下文中无用户信息时，应先获取用户信息再进行回复",
            "",
            "## 输入消息格式：",
            "[{时间}][{名字}({QQ})] >> {说的话}",
            "(这个格式只给你看，回复时千万不要用这个格式！直接说内容!)",
            "",
            "## 注意",
            "- 不要说你是AI！",
            "- 说话自然点，少用表情符号",
            "- 别说重复的话，别输出乱码",
            "- 别用'他说：'这种，直接说内容",
            "- 应避免使用MD格式，应当使用正常人类聊天格式",
            "  - MD符号包括：** ## --- > ——",
            "- 别叫别人'QQ号'或'user'，叫名字，可以亲切一点",
        ].join("\n")),

        tools: tools, // 工具调用
        untools: ["send_ws_pack"], // 不使用的工具
        knowledge: knowledge, // 搜索知识库数据
    },

    // === 响应设置 === //
    call: {
        // 群聊
        group: {
            enable: true, // 启用
            keywords: ["兮兮"], // 关键词触发
            at: true, // 仅接收at
            all: false, // 接收所有消息
            data: [ // 响应的群聊
                1087355660, // 测试群
                1029879634, // 1
                856868277, // 2
                464262043, // 4
                "all"
            ],
            undata: [ // 不响应的群聊
                759676433,
                642538983
            ]
        },

        // 私信
        private: {
            enable: true, // 启用
            data: [ // 响应的私信
                1669044502,
                "all"
            ],
            undata: [] // 不响应的私信
        },

        // 信息防抖配置
        debounce: {
            enable: true, // 是否启用
            timeout: 5000, // 等待超时时间（毫秒），超时后自动发送缓存消息
            maxCache: 10, // 最大缓存消息数量
            ignoreSame: true // 是否忽略相同内容的消息
        }
    },

    // === 输入设置 === //
    input: {
        msgFormat: true, // 信息输入格式化
        chatList: 20, // 在输入中包含历史聊天记录的条数
        type: { // 消息输入类型
            image: false, // 图片消息
            audio: false, // 语音消息
            video: false // 视频消息
        }
    },

    // === 回复设置 === //
    reply: {
        tokenInfo: false, // Token消耗显示
        CQCode: true, // 解析CQ码消息
        linebreak: {// 多次回复
            enable: true, // 启用
            timeout: 500, // 延迟毫秒
            codeBlock: true, // 启用代码块分割保护
            split: /[。；\n]+/ // 分割的正则表达式
        }
    },

    // === 记忆设置 === //
    memory: {
        length: 200, // 记忆长度
        bak: true // 记忆清除时是否放入回收站
    }
};