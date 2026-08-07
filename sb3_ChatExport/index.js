
// === 配置相关 === //
const configFile = spark.getFileHelper('ChatExport');
configFile.initFile("config.json", {
    group: [spark.env.get("main_group")],
    group_all: true,

    cmd: "/chatexp",
    max: 20000
})

// 网页配置
const config = JSON.parse(configFile.read("config.json"));
spark.web.createConfig("ChatExport")
    .array("group", config.group, "允许的群组")
    .switch("group_all", config.group_all, "允许所有群组")

    .text("cmd", config.cmd, "触发指令")
    .number("max", config.max, "最大记录获取数")
    .register();

spark.on("config.update.ChatExport", (key, val) => {
    if (key === "group" || key === "private")
        val = val.map(Number);
    config[key] = val;
    configFile.write('config.json', config);
});

// === 实际逻辑 === //

// 群聊
spark.on('message.group.normal', async (pack, reply) => {
    if (!((config.group_all
        || config.group.includes(pack.group_id))
        && pack.raw_message.startsWith(config.cmd)
    )) return;

    const cmd = pack.raw_message.split(" ");
    const count = Math.min(Number(cmd?.[1] ?? config.max), config.max);
    const noFormat = cmd?.[2] === "true";
    const group = Number(cmd?.[3]) ?? pack.group_id;

    reply(`抓取${count}条聊天记录中...`);

    try {
        let msgData = (await request('get_group_msg_history', {
            group_id: group,
            count: count,
            reverseOrder: false
        }, 30 * 1000))?.data?.messages ?? [];

        if (!noFormat)
            msgData = msgData?.map(msg => {
                if (!msg?.raw_message) return;
                return {
                    time: (new Date(msg.time * 1000)).toLocaleString(),
                    real_seq: msg.real_seq,
                    sender: msg.sender,
                    raw_message: msg.raw_message
                };
            });

        const base64 = Buffer.from(
            JSON.stringify(msgData, null, 4)
        ).toString('base64');

        reply(`上传文件中，大小：${(base64.length / 1024).toFixed(3)} KB`);

        await spark.QClient.uploadGroupFile(
            pack.group_id,
            `base64://${base64}`,
            `ChatExport-${group}.json`,
            '' // 根目录
        );

    } catch (e) {
        reply(`抓取聊天记录时出现错误\n${e.toString()}`);
    }
})


const pendingRequests = new Map();
spark.on('gocq.pack', (pack) => {
    if (!pack.echo) return;
    const pending = pendingRequests.get(pack.echo);
    if (!pending) return;
    clearTimeout(pending.timer);
    pending.resolve(pack);
    pendingRequests.delete(pack.echo);
});

function request(action, params, timeout = 10000) {
    return new Promise((resolve, reject) => {
        const echoId = `${action}_${Date.now()}_${Math.random().toString(36).slice(2)}`;
        const timer = setTimeout(() => {
            const pending = pendingRequests.get(echoId);
            if (pending) {
                pendingRequests.delete(echoId);
                reject(new Error(`${action} 请求超时`));
            }
        }, timeout);
        pendingRequests.set(echoId, { resolve, reject, timer });
        spark.QClient.sendWSPack({
            action: action,
            echo: echoId,
            params: params
        });
    });
}