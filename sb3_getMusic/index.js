const axios = require('axios');

// === 配置相关 === //
const configFile = spark.getFileHelper('getMusic');
configFile.initFile("config.json", {
    group: [spark.env.get("main_group")],
    group_all: false,
    private: [],
    private_all: true,

    cmd: "/music",
    url: "https://www.yueting.net/tool/music/"
})

// 网页配置
const config = JSON.parse(configFile.read("config.json"));
spark.web.createConfig("getMusic")
    .array("group", config.group, "允许的群组")
    .switch("group_all", config.group_all, "允许所有群组")
    .array("private", config.private, "允许的私聊")
    .switch("private_all", config.private_all, "允许所有私聊")

    .text("cmd", config.cmd, "触发指令")
    .text("url", config.url, "请求端点")
    .register();

spark.on("config.update.getMusic", (key, val) => {
    if (key === "group" || key === "private")
        val = val.map(Number);
    config[key] = val;
    configFile.write('config.json', config);
});

// === 实际逻辑 === //

// 群聊
spark.on('message.group.normal', (pack, reply) => {
    if (!((config.group_all
        || config.group.includes(pack.group_id))
        && pack.raw_message.startsWith(config.cmd)
    )) return;

    onMessage(pack, reply);
})

// 私聊
spark.on('message.private.friend', (pack, reply) => {
    if (!((config.private_all
        || config.private.includes(pack.target_id))
        && pack.raw_message.startsWith(config.cmd)
    )) return;

    onMessage(pack, reply);
});

async function onMessage(pack, reply) {
    const cmd = pack.message
        .map(i => i.type === "text" ? i.data.text : "")
        .join("")
        .slice(config.cmd.length + 1)
        .split(" ");

    // logger.info(JSON.stringify(cmd, null, 4))
    const musicList = await getMusic(cmd.join(" "));
    const replyMsg = [
        spark.msgbuilder.reply(pack.real_id)
    ];

    if (musicList.length === 0)
        replyMsg.push(spark.msgbuilder.text(`未搜索到有关 "${cmd.join(" ")}" 的内容`));
    else {
        musicList.forEach(i => {
            replyMsg.push(spark.msgbuilder.img(i.pic))
            replyMsg.push(spark.msgbuilder.text([
                `- 名称: ${i.title ?? "匿名"}`,
                `- 作者: ${i.author ?? "匿名"}`,
                `- url: ${i.url}`,
                "---\n "
            ].join("\n")))
        });
    }

    reply(replyMsg);
}

// 导出AI调用工具
spark.on("event.aichat.starts", () => {
    spark.emit("event.aichat.add_tools", "get_music", {
        definition: {
            type: "function",
            function: {
                description: "查询一些网易云音乐的信息",
                parameters: {
                    type: "object",
                    properties: {
                        query: {
                            type: "string",
                            description: "查询的音乐名称",
                        }
                    },
                    required: ["query"]
                }
            }
        },
        call: async (chatData, query) => {
            return await getMusic(query);
        }
    })
})


async function getMusic(name) {
    const data = await axios.post(config.url, {
        input: name, // 音乐名
        type: "netease", // 平台
        filter: 'name',
        page: 1
    }, {
        headers: {
            'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
            'X-Requested-With': 'XMLHttpRequest',
            // 'Referer': `https://www.yueting.net/tool/music/?name=${encodeURIComponent(name)}&type=netease`,
            // 'User-Agent': 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/137.0.0.0 Safari/537.36'
        }
    })

    logger.warn(JSON.stringify(data, (key, value) => {
        if (key === 'request' || key === 'config' || key === 'headers') return undefined;
        if (typeof value === 'bigint') return value.toString();
        return value;
    }, 4))
    return data.data.data;
}