const axios = require('axios');

// === 配置相关 === //
const configFile = spark.getFileHelper('getMusic');
configFile.initFile("config.json", {
    group: [spark.env.get("main_group")],
    group_all: false,
    private: [],
    private_all: true,

    cmd: "/music",
    auto_analysis: true,

    url: "https://www.yueting.net/tool/music/",
    web_ua: "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/137.0.7120.0 Safari/537.36",
    web_referer: true
})

// 网页配置
const config = JSON.parse(configFile.read("config.json"));
spark.web.createConfig("getMusic")
    .array("group", config.group, "允许的群组")
    .switch("group_all", config.group_all, "允许所有群组")
    .array("private", config.private, "允许的私聊")
    .switch("private_all", config.private_all, "允许所有私聊")

    .text("cmd", config.cmd, "触发指令")
    .switch("auto_analysis", config.auto_analysis, "自动解析url")

    .text("url", config.url, "请求端点")
    .text("web_ua", config.web_ua, "请求UA (留空不请求)")
    .switch("web_referer", config.web_referer, "启用Referer")
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
        && (pack.raw_message.startsWith(config.cmd)
        || (config.auto_analysis && pack.raw_message.includes("//music.163.com")))
    )) return;

    onMessage(pack, reply);
})

// 私聊
spark.on('message.private.friend', (pack, reply) => {
    if (!((config.private_all
        || config.private.includes(pack.target_id))
        && (pack.raw_message.startsWith(config.cmd)
        || (config.auto_analysis && pack.raw_message.includes("//music.163.com")))
    )) return;

    onMessage(pack, reply);
});

async function onMessage(pack, reply) {
    const cmd = pack.message
        .map(i => i.type === "text" ? i.data.text : "")
        .join("")

    let musicList = [];
    if (config.auto_analysis && cmd.includes("music.163.com"))
        musicList = await getMusic(cmd, "url");
    else
        musicList = await getMusic(
            cmd
                .slice(config.cmd.length + 1)
                .split(" ")
                .join(" ")
        );
    // logger.info(JSON.stringify(cmd, null, 4))
    
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
                        data: {
                            type: "string",
                            description: "查询的音乐数据，名称或链接",
                        },
                        mode: {
                            type: "string",
                            enum: ["name", "url"],
                            description: "模式",
                        },
                        type: {
                            type: "string",
                            description: "要查询的平台，默认'netease'(网易云)",
                        },
                        page: {
                            "type": "integer",
                            "description": "翻页页数",
                            "minimum": 1,
                        },
                        lyrics: {
                            type: 'boolean',
                            description: '是否返回完整歌词；通常很大，默认选择false',
                            default: false
                        }
                    },
                    required: ["data", "mode", "type", "page", "lyrics"]
                }
            }
        },
        call: async (chatData, data, mode, type, page, lyrics) => {
            const res = await getMusic(data, mode, type, page);
            if (!res) return "未获取到相关内容，确定参数或名称是对的吗？";
            return res.map(i => {
                return {
                    '名称': i.title,
                    '作者': i.author,
                    '歌词': lyrics ? "*" : i.lrc,
                    '原页面': i.link,
                    '音乐直链': i.url,
                    '音乐图标': i.pic
                }
            })
        }
    })
})


async function getMusic(data, mode = "name", type = "netease", page = 1) {
    const res = await axios.post(config.url, {
        input: data,
        type: type,
        filter: mode,
        page: page
    }, {
        headers: {
            'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
            'X-Requested-With': 'XMLHttpRequest',

            ...config.web_ua === ""
                ? {}
                : { "User-Agent": config.web_ua },

            ...config.web_referer
                ? { "Referer": `${config.url}?${mode}=${encodeURIComponent(data)}&type=${type}&page=${page}` }
                : {}
        }
    })


    logger.warn(JSON.stringify(res, (key, value) => {
        if (key === 'request' || key === 'config' || key === 'headers') return undefined;
        if (typeof value === 'bigint') return value.toString();
        return value;
    }, 4))
    return res.data.data;
}
/*

curl -X POST 'https://www.yueting.net/tool/music/' \
-H 'Content-Type: application/x-www-form-urlencoded; charset=UTF-8' \
-H 'X-Requested-With: XMLHttpRequest' \
-H 'User-Agent: Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/137.0.0.0 Safari/537.36' \

--data-urlencode 'input=are you lost'  \
--data-urlencode 'filter=name'  \
--data-urlencode 'type=netease'  \
--data-urlencode 'page=1'

--data-urlencode 'input=https://music.163.com/#/song?id=39227633' \
--data-urlencode 'filter=url' \
--data-urlencode 'type=netease' \
--data-urlencode 
--data-urlencode 

[
    {
        "type": "",
        "link": "",
        "songid": 39227633,
        "title": "His Theme",
        "author": "Toby Fox",
        "lrc": "",
        "url": "http://music.163.com/song/media/outer/url?id=39227633.mp3",
        "pic": "http://p1.music.126.net/mQcab-6L7D-w1lRxmYB7MQ==/109951168015051713.jpg?param=300x300"
    }
]

*/



