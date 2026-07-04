let is_reload = false;
const config = {
    // 转发聊天的群聊
    QQChat: 759676433,
    Admin: new Set([
        1669044502,
        3827764490,
        ...spark.env.get("admin_qq") ?? []
    ]),

    MC2QQ: {
        Chat: true, // 聊天
        Join: true, // 加入
        Left: true, // 退出
        Say: true // 广播
    },

    QQ2MC: {
        Chat: { // 聊天
            enable: true, // 是否启用
            face: true, // 表情转义 (需要QQFace插件材质包)
            export: (userName, msg) => { // 对其他聊天插件兼容
                if (ll.hasExported("BDSLM", "addMsg"))
                    ll.imports("BDSLM", "addMsg")({
                        type: 'chat',
                        source: "QQ",
                        realName: `§eQQ群§7|§6${userName}§a`,
                        msg: msg
                    });
            }
        },
        Cmd: { // 运行命令
            enable: true, // 是否启用
            divisionNum: 100000, // 分割长度
            player: [ // 普通用户可以执行的指令
                "/list",
                "/help"
            ]
        }
    },

    // 导出工具给大模型使用
    AITools: {
        enable: true, // 是否启用
        chat: true, // 聊天记录
        system: true, // 进出信息
    },

    // 敏感词过滤
    WordFilter: {
        enable: true, // 是否启用
        mode: 1, // 调用模式 (1: 内置的, 2: API)
        use: { // 启用过滤的功能
            QQ: true, // 消息发送至QQ群时过滤
            MC: true // 消息发送至MC时过滤
        },

        // 内置的过滤系统
        // 内置的系统过滤可能比较简单
        Internal: {
            word: ["操你", "傻逼", "死", "fuck"], // 敏感词列表
            replaceChar: "喵" // 替换敏感词的字符，比如：fuck -> 喵喵喵喵
        },

        // API模式
        // 调用解析
        // 使用此功能可接入其更强大的敏感词过滤插件
        // 输入玩家发送的原始信息，返回过滤后的信息
        // >> 需要LSE-js基础，如果你不知道此项该如何使用请不要使用此项！
        API: (msg) => {
            return ll.imports('WordFilter', 'filter')(msg);
        }
    }
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
    if (config.QQ2MC.Cmd
        && msg.startsWith("/")
        && (config.Admin.has(pack.user_id - 0)
            || config.QQ2MC.Cmd.player.some(cmd => msg.startsWith(cmd))
        )
    ) {
        const res = mc.runcmdEx(msg)?.output ?? "";
        if (res === false) return;
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
                    reply(text)
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
    if (config.WordFilter.mode === 1) {
        msg = msg.replace(sensitive_regex, (match) => {
            return config.WordFilter.replaceChar.repeat(match.length);
        });
    } else msg = config.WordFilter.API(msg);
    return msg;
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
            case 'image': return "[图片]";
            case 'face': {
                if (!config.QQ2MC.Chat.face) return "[表情]";
                if (emojiList[index])
                    return emojiList[index];
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