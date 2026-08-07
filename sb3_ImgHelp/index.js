const path = require('path');
const fs = require('fs');

const config = {
    group: [759676433],
    group_all: true,
    private: [1669044502],
    private_all: true,

    // 功能列表
    mode: {
        ai_tool: true, // 让大模型调用
        send_mode: 0, // 主动发送模式 -1: 关闭 0: 精准匹配 1: 关键词匹配
        local_file: true, // 加载本地图片
        fileExt: [ // 本地图片支持的后缀
            ".jpg",
            ".jpeg",
            ".png",
            ".gif",
            ".webp"
        ]
    },

    // 预设图片表
    // 支持网络URL和本地文件名
    // 该项目的优先级高于本地文件名
    // 不要有重名的!!!!!!!!!!!!!!!!!!
    imgs: {
        "/光遇 每日任务": "https://api.qmkjcm.cn/api/gy/rwt/images/sc_image.jpg",
        "/光遇 复刻先祖": "https://api.qmkjcm.cn/api/gy/fk/images/sc_image.jpg",
        "/光遇 大蜡烛": "https://api.qmkjcm.cn/api/gy/dlz/images/sc_image.jpg",
        "/光遇 活动": "https://api.qmkjcm.cn/api/gy/ac"
    }
};


const imgMap = new Map(Object.entries(config.imgs));


// 加载本地图片文件夹
let isInit = true;
addFileImg();
function addFileImg() {
    if (config.mode.local_file) {
        const cfgImgsList = Object.values(config.imgs);
        const cfgImgsData = Object.fromEntries(
            Object.entries(config.imgs).map(([key, value]) => [value, key])
        );

        if (isInit) isInit = false;

        const imgDir = path.join(__dirname, 'images');
        if (fs.existsSync(imgDir)) {
            let loadNum = 0;
            fs.readdirSync(imgDir)
                .forEach(file => {
                    if (!config.mode.fileExt.includes(
                        path.extname(file).toLowerCase()
                    )) return;

                    const name = path.parse(file).name;

                    if (!isInit && imgMap.get(name)) return;
                    if (cfgImgsList.includes(name))
                        imgMap.set(cfgImgsData[name], path.join(imgDir, file));
                    else
                        imgMap.set(name, path.join(imgDir, file));
                    loadNum++;
                });
            if (loadNum >= 1)
                logger.info(`加载了 ${loadNum} 张本地图片`);
        } else fs.mkdirSync(imgDir, { recursive: true });
    }
}



// 群聊
spark.on('message.group.normal', (pack, reply) => {
    if (!(config.group_all || config.group.includes(pack.group_id))) return;
    onMessage(pack.raw_message?.trim() || '', reply);
});

// 私聊
spark.on('message.private.friend', (pack, reply) => {
    if (!(config.private_all || config.private.includes(pack.user_id))) return;
    onMessage(pack.raw_message?.trim() || '', reply);
});

const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));
async function onMessage(rawMsg, reply) {
    if (!rawMsg || config.mode.send_mode === -1) return;

    // 精准匹配
    if (config.mode.send_mode === 0)
        return imgMap.has(rawMsg)
            ? reply(imgMap.get(rawMsg))
            : null;

    // 模糊匹配
    for (const [name, url] of [...imgMap]) {
        if (!rawMsg.includes(name)) continue;

        try {
            await reply(spark.msgbuilder.img(url));
            await sleep(300);
        } catch (error) {
            logger.error(`发送图片失败: ${error.message}`);
        }
    }
}

// AI工具调用
spark.on("event.aichat.starts", () => {
    if (!config.mode.ai_tool) return;

    spark.emit("event.aichat.add_tools", "get_preset_image_list", {
        definition: {
            type: "function",
            function: {
                name: "send_image",
                description: "获取所有预设图片列表，每次调用时刷新缓存",
                parameters: {
                    type: "object",
                    properties: {},
                    required: []
                }
            }
        },
        call: () => {
            addFileImg();
            return [...imgMap.keys()];
        }
    });

    spark.emit("event.aichat.add_tools", "send_preset_image", {
        definition: {
            type: "function",
            function: {
                description: "向用户发送预设图片，可以当表情使用; 使用前请调用get_preset_image_list工具获取列表",
                parameters: {
                    type: "object",
                    properties: {
                        image: {
                            type: "string",
                            description: `图片预设词`
                        }
                    },
                    required: ["image"]
                }
            }
        },
        call: async (chatData, image) => {
            if (!imgMap.has(image))
                return `无法找到与 "" 相关的图片/表情，请修正后再次尝试，或调用get_preset_image_list工具获取新列表`;

            const msg = spark.msgbuilder.img(imgMap.get(image))
            if (chatData.is_target)
                return spark.QClient.sendPrivateMsg(chatData.uid.slice(7), msg);
            else
                return spark.QClient.sendGroupMsg(chatData.uid, msg);
        }
    });
});
