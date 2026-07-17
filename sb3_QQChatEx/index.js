// 补药修改这里的配置，去网页面板修改！！！
// 补药修改这里的配置，去网页面板修改！！！
// 补药修改这里的配置，去网页面板修改！！！

// （硬编码配置除外）


// === 配置相关 === //
const configFile = spark.getFileHelper('QQChatEX');
configFile.initFile("config.json", {
    QQChat: spark.env.get("main_group"),
    Admin: [...spark.env.get("admin_qq") ?? []],
    MC2QQ: {
        Chat: true,
        Join: true,
        Left: true,
        Say: true
    },

    QQ2MC: {
        Chat: {
            enable: true,
            face: true,
            imgUrl: false
        },
        Cmd: {
            enable: true,
            divisionNum: 100000,
            player: [
                "/list",
                "/help"
            ]
        }
    },

    AITools: {
        enable: true,
        chat: true,
        system: true,
    },

    WordFilter: {
        enable: true,
        use: {
            QQ: true,
            MC: true
        },

        Internal: {
            word: ["操你", "傻逼", "死", "fuck"],
            replaceChar: "喵"
        }
    }
})

// 网页配置
const config = JSON.parse(configFile.read("config.json"));
spark.web.createConfig("QQChatEX")
    .number("QQChat", config.QQChat, "要转发聊天的群")
    .array("Admin", config.Admin, "可以执行后台指令的QQ")

    .switch("MC2QQ.Chat", config.MC2QQ.Chat, "MC2QQ-聊天信息")
    .switch("MC2QQ.Join", config.MC2QQ.Join, "MC2QQ-加入信息")
    .switch("MC2QQ.Left", config.MC2QQ.Left, "MC2QQ-退出信息")
    .switch("MC2QQ.Say", config.MC2QQ.Say, "MC2QQ-后台广播")

    .switch("QQ2MC.Chat.enable", config.QQ2MC.Chat.enable, "QQ2MC-聊天信息")
    .switch("QQ2MC.Chat.face", config.QQ2MC.Chat.face, "QQ2MC-转义表情 (需要QQFace插件材质包)")
    .switch("QQ2MC.Chat.imgUrl", config.QQ2MC.Chat.imgUrl, "QQ2MC-转义图片url")

    .switch("QQ2MC.Cmd.enable", config.QQ2MC.Cmd.enable, "QQ2MC-执行后台")
    .number("QQ2MC.Cmd.divisionNum", config.QQ2MC.Cmd.divisionNum, "QQ2MC-命令返回值分割界限")
    .array("QQ2MC.Cmd.player", config.QQ2MC.Cmd.player, "QQ2MC-玩家可以执行的指令")

    .switch("AITools.enable", config.AITools.enable, "AITool-外部AI工具调用")
    .switch("AITools.chat", config.AITools.chat, "AITool-模型可读取聊天记录")
    .switch("AITools.system", config.AITools.system, "AITool-模型可读取进出记录")

    .switch("WordFilter.enable", config.WordFilter.enable, "WordFilter-敏感词过滤")
    .switch("WordFilter.use.QQ", config.WordFilter.use.QQ, "WordFilter-QQ消息过滤")
    .switch("WordFilter.use.MC", config.WordFilter.use.MC, "WordFilter-MC消息过滤")
    .array("WordFilter.Internal.word", config.WordFilter.Internal.word, "WordFilter-敏感词列表")
    .text("WordFilter.Internal.replaceChar", config.WordFilter.Internal.replaceChar, "WordFilter-替换字符")

    .register();

spark.on("config.update.QQChatEX", (key, val) => {
    if (["Admin", "QQ2MC.Cmd.player", "WordFilter.Internal.word"].includes(key))
        val = val.map(String);

    // 处理嵌套配置项的赋值
    const keys = key.split('.');
    if (keys.length === 1) {
        config[key] = val;
    } else {
        let obj = config;
        for (let i = 0; i < keys.length - 1; i++) {
            obj = obj[keys[i]];
        }
        obj[keys[keys.length - 1]] = val;
    }

    configFile.write('config.json', JSON.stringify(config, null, 4));
});

// === 硬编码配置文件 === //

// 对其他聊天插件兼容
config.QQ2MC.Chat.export = (userName, msg) => {
    if (ll.hasExported("BDSLM", "addMsg"))
        ll.imports("BDSLM", "addMsg")({
            type: 'chat',
            source: "QQ",
            realName: `§eQQ群§7|§6${userName}§a`,
            msg: msg
        });
}




// AI工具调用
const aiMsgList = [];
spark.on("event.aichat.starts", () => {
    spark.emit("event.aichat.add_tools", "get_qyserver_chat_info", {
        definition: {
            type: "function",
            function: {
                description: "获取服务器内聊天信息",
                parameters: {
                    type: "object",
                    properties: {},
                    required: []
                }
            }
        },
        call: () => aiMsgList.join("\n")
    });

    spark.emit("event.aichat.add_tools", "get_qyserver_info", {
        definition: {
            type: "function",
            function: {
                description: "获取服务器当前实时信息，比如人数/游戏天数等内容",
                parameters: {
                    type: "object",
                    properties: {},
                    required: []
                }
            }
        },
        call: () => [
            `${mc.runcmdEx("list").output}`,
            `版本：${mc.getBDSVersion()}(${mc.getServerProtocolVersion()})`,
            `游戏时间: ${mc.getTime(2)}天(${mc.getTime(1)}tick)`
        ].join("\n")
    });
});

let is_reload = false;

// === MC2QQ === //
// Chat - 聊天
if (config.MC2QQ.Chat)
    mc.listen("onChat", (pl, msg) => {
        if (msg[0] === "+") return;

        if (config.WordFilter.enable
            && config.WordFilter.use.MC
        ) msg = WFilter(msg);

        msg = `[${{ 0: "主世界", 1: "下界", 2: "末地" }[pl.pos.dimid] || "未知"}]`
            + `${pl.getDevice()?.avgPing > 100 ? `[${pl.getDevice().avgPing}ms]` : ""}`
            + `${pl.realName} >> ${msg}`;

        if (config.AITools.enable && config.AITools.chat)
            aiMsgList.push(`[${new Date().toLocaleString('zh-CN', { hour12: false })}][MC]${msg}`);

        spark.QClient.sendGroupMsg(config.QQChat, msg);
    });

// Join - 加入
if (config.MC2QQ.Join)
    mc.listen("onJoin", (pl) => {
        if (is_reload) return;
        if (config.AITools.enable && config.AITools.system)
            aiMsgList.push(`[${new Date().toLocaleString('zh-CN', { hour12: false })}][MC]${pl.realName} 进入服务器`);
        spark.QClient.sendGroupMsg(config.QQChat, `${pl.realName} 进入服务器`);
    });

// Left - 退出
if (config.MC2QQ.Left)
    mc.listen("onLeft", (pl) => {
        if (is_reload) return;
        if (config.AITools.enable && config.AITools.system)
            aiMsgList.push(`[${new Date().toLocaleString('zh-CN', { hour12: false })}][MC]${pl.realName} 退出服务器`);
        spark.QClient.sendGroupMsg(config.QQChat, `${pl.realName} 退出服务器`);
    });


// Say - 广播
if (config.MC2QQ.Say)
    mc.listen("onConsoleCmd", (cmd) => {
        if (!cmd.startsWith("say ")) return;
        spark.QClient.sendGroupMsg(config.QQChat, `[服务器娘] ${cmd.slice(4)}`);
    });

ll.exports((msg) => spark.QClient.sendGroupMsg(config.QQChat, `${WFilter(msg)}`), "QQChatEx", "onSendChat");
mc.listen("onConsoleCmd", (cmd) => {
    if (cmd === "ll reload sparkbridge3") is_reload = true;
})


// === QQ2MC === //
spark.on('message.group.normal', async (pack, reply) => {
    if (!(pack.group_id === config.QQChat
        && pack.message.length !== 0
    )) return;

    const userName = pack.sender.card || pack.sender.nickname;
    const msg = (await formatMsg(pack.message, pack)).replace(/\n/g, "\\n");

    // Cmd - 运行命令
    if (config.QQ2MC.Cmd.enable && msg.startsWith("/")) {
        if (!(config.Admin.includes(`${pack.user_id}`)
            || config.QQ2MC.Cmd.player.some(cmd => msg.startsWith(cmd))
        )) return;

        const res = mc.runcmdEx(msg)?.output ?? "";
        if (res.includes("请检查命令是否存在，以及您对它是否拥有使用权限。")) return;

        // 不按换行分割，直接按字符数切分
        const splitIntoChunks = (str, size) => {
            const chunks = [];
            for (let i = 0; i < str.length; i += size) {
                chunks.push(str.slice(i, i + size));
            }
            return chunks;
        };

        let msgIndex = 0;
        splitIntoChunks(res, config.QQ2MC.Cmd.divisionNum)
            .forEach(msg => {
                setTimeout(() => {
                    reply(msg)
                }, 500 * msgIndex);
                msgIndex++
            });

        logger.setTitle("QQCommand");
        logger.info(`${userName} >> ${msg}\n>> ${res}\n`);
        logger.setTitle("Server");
        return;
    }

    // Chat - 聊天
    if (config.QQ2MC.Chat) {
        let chatMsg = msg;
        const replyId = (pack.message.find(t => t.type === 'reply'))?.data?.id ?? null;

        if (config.WordFilter.enable
            && config.WordFilter.use.QQ
        ) chatMsg = WFilter(msg);

        if (replyId !== null) {
            const reply = await spark.QClient.getMsg(replyId);
            const msgData = (await formatMsg(reply.message, reply)).match(/\[([^\]]+)\](?:\[[^\]]+\])?([^>]+)>>\s*(.+)/);
            if (msgData && msgData[2]) chatMsg = `@${msgData[2]} §6回复 "${msgData[3].slice(0, 5)}..."§r： ${chatMsg}`;
        }

        if (config.AITools.enable && config.AITools.chat)
            aiMsgList.push(`[${new Date().toLocaleString('zh-CN', { hour12: false })}][QQ]${userName} >> ${msg}`);
        config.QQ2MC.Chat.export(userName, msg);
        mc.broadcast(`[§6QQ群§r]${userName}§r >> ${chatMsg}`);
        logger.setTitle("QQBot");
        logger.info(`${userName} >> ${chatMsg}`);
        logger.setTitle("Server");
    }
})

const sensitive_regex = new RegExp(config.WordFilter.Internal.word.join("|"), "gi");
function WFilter(msg) {
    return msg.replace(sensitive_regex, (match) => {
        return config.WordFilter.replaceChar.repeat(match.length);
    });
}

const faceList = {
    "0": "", "1": "", "2": "", "3": "", "4": "", "5": "", "6": "", "7": "", "8": "", "9": "", "10": "", "11": "", "12": "", "13": "", "14": "", "15": "", "16": "", "18": "", "19": "",
    "20": "", "21": "", "22": "", "23": "", "24": "", "25": "", "26": "", "27": "", "28": "", "29": "", "30": "", "31": "", "32": "", "33": "", "34": "", "35": "", "36": "", "37": "",
    "38": "", "39": "", "41": "", "42": "", "43": "", "46": "", "49": "", "53": "", "56": "", "59": "", "60": "", "63": "", "64": "", "66": "", "67": "", "74": "", "75": "", "76": "",
    "77": "", "78": "", "79": "", "85": "", "86": "", "89": "", "96": "", "97": "", "98": "", "99": "", "100": "", "101": "", "102": "", "103": "", "104": "", "105": "", "106": "",
    "107": "", "108": "", "109": "", "110": "", "111": "", "112": "", "114": "", "116": "", "118": "", "119": "", "120": "", "121": "", "123": "", "124": "", "125": "", "129": "",
    "137": "", "144": "", "146": "", "147": "", "169": "", "171": "", "172": "", "173": "", "174": "", "175": "", "176": "", "177": "", "178": "", "179": "", "181": "", "182": "",
    "183": "", "185": "", "187": "", "201": "", "212": "", "262": "", "263": "", "264": "", "265": "", "266": "", "267": "", "268": "", "269": "", "270": "", "271": "", "272": "",
    "273": "", "277": "", "281": "", "282": "", "283": "", "284": "", "285": "", "286": "", "287": "", "289": "", "293": "", "294": "", "295": "", "297": "", "298": "", "299": "",
    "300": "", "302": "", "303": "", "305": "", "306": "", "307": "", "311": "", "312": "", "314": "", "317": "", "318": "", "319": "", "320": "", "323": "", "324": "", "325": "",
    "326": "", "332": "", "333": "", "334": "", "336": "", "337": "", "338": "", "339": "", "341": "", "342": "", "343": "", "344": "", "345": "", "346": "", "347": "", "349": "",
    "350": "", "351": "", "352": "", "353": "", "354": "", "355": "", "356": "", "357": "", "358": "", "359": "", "392": "", "393": "", "394": "", "395": "", "415": "", "416": "",
    "417": "", "419": "", "420": "", "421": "", "422": "", "423": "", "424": "", "425": "", "426": "", "427": "", "428": "", "429": "", "430": "", "431": "", "432": ""
};

async function formatMsg(msg, pack) {
    const results = await Promise.all(msg.map(async (t) => {
        switch (t.type) {
            case 'text': return t.data.text;
            case 'image': {
                return config.QQ2MC.Chat.imgUrl
                    ? `[图片](${t.data.url})`
                    : "[图片]"
            }
            case 'face': {
                if (!config.QQ2MC.Chat.face) return t.data.faceText || "[表情]";
                if (faceList[t.data.id])
                    return faceList[t.data.id];
                else
                    return t.data.faceText || "[表情]";
            }
            case 'at': {
                const info = await spark.QClient.getGroupMemberInfo(pack.group_id, t.data.qq)
                return `@${info.card || info.nickname || `${t.data.qq}`}`;
            }
            default: return "";
        }
    }));
    return results.join("");
}