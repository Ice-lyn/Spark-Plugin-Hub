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

// AI工具调用
spark.on("event.aichat.starts", () => {
    // 合并所有可用图片命令
    const allCmds = [...Object.keys(config.imgs), ...Object.keys(localImages).map(k => `/${k}`)];

    spark.emit("event.aichat.add_tools", "send_presupposition_image", {
        definition: {
            type: "function",
            function: {
                name: "send_image",
                description: "向用户发送预设图片",
                parameters: {
                    type: "object",
                    properties: {
                        image: {
                            type: "string",
                            description: "图片预设词",
                            enum: allCmds
                        }
                    },
                    required: ["image"]
                }
            }
        },
        call: async (chatData, image) => {
            return await onMessage(image, (...msg) => {
                if (chatData.is_target)
                    return spark.QClient.sendPrivateMsg(chatData.uid.slice(7), ...msg);
                else
                    return spark.QClient.sendGroupMsg(chatData.uid, ...msg);
            }) ?? "";
        }
    });
});

async function onMessage(rawMsg, reply) {
    if (!rawMsg) return "rawMsg is null";

    let imageUrls = [];
    if (config.mode === 0) { // 精准匹配
        if (config.imgs[rawMsg] != null) {
            imageUrls = [config.imgs[rawMsg]];
        }
    } else { // 关键词匹配
        imageUrls = getImagesByKeyword(rawMsg);
    }

    if (imageUrls.length === 0) return "url length is 0";

    for (const url of imageUrls) {
        try {
            await reply(spark.msgbuilder.img(url));
            await sleep(300);
        } catch (error) {
            logger.error(`发送图片失败: ${error.message}`);
        }
    }
    return "图片已发送";
}

function getImagesByKeyword(text) {
    const results = [];
    for (const [key, value] of Object.entries(config.imgs)) {
        if (text.includes(key)) {
            results.push(value);
        }
    }
    return results;
}

function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}
