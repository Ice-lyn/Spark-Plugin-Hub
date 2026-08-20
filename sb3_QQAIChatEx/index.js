const parseCQString = require('../../handles/parserCQString.js');
const config = require('./Config/config.js');
const axios = require('axios');
const path = require('path');
const fs = require('fs');

const memoryMap = new Map(); // 记忆缓存
const retryMap = new Map(); // 重试操作次数
const debounceMap = new Map(); // 防抖
const tools = cleanTools(config.ai.tools, config.ai.untools); // 工具定义
const toolsIndex = new Map( // 工具参数索引
    tools.definition.map(obj => [obj.function.name, obj.function.parameters.required])
);

const memoryDir = path.join(__dirname, 'memory');
const memoryBakDir = path.join(__dirname, 'memory_bak');
if (!fs.existsSync(memoryDir)) fs.mkdirSync(memoryDir, { recursive: true });
if (!fs.existsSync(memoryBakDir)) fs.mkdirSync(memoryBakDir, { recursive: true });

// 群聊
const groupData = config.call.group;
spark.on('message.group.normal', async (pack, reply) => {
    if (!(groupData.enable // 总开关
        && (groupData.data.includes(pack.group_id) || groupData.data.includes("all"))
    )) return;

    if (groupData.undata.includes(pack.group_id)) return;

    if (pack.raw_message.startsWith("/aichat "))
        return onCommand(`${pack.group_id}`, pack, reply);

    // 接受所有消息
    if (groupData.all) return onMessage(`${pack.group_id}`, pack, reply);

    // 关键词
    if (groupData.keywords.length > 0
        && groupData.keywords.some(key => pack.raw_message.includes(key))
    ) return onMessage(`${pack.group_id}`, pack, reply);

    // at
    if (groupData.at
        && pack.message.some(i => (i.type === "at" && i.data.qq == pack.self_id))
    ) return onMessage(`${pack.group_id}`, pack, reply);
});

// 私聊
const privateData = config.call.private;
spark.on('message.private.friend', async (pack, reply) => {
    if (!(privateData.enable
        && (privateData.data.includes(pack.user_id) || privateData.data.includes("all"))
    )) return;

    if (privateData.undata.includes(pack.user_id)) return;

    if (pack.raw_message.startsWith("/aichat "))
        return onCommand(`target_${pack.user_id}`, pack, reply);

    onMessage(`target_${pack.user_id}`, pack, reply);
});

// 其他插件注册工具
spark.on("core.ready", () => {
    setTimeout(() => {
        spark.emit("event.aichat.starts", Date.now())
    }, 3000)
})

spark.on("event.aichat.add_tools", (name, tool) => {
    if (config.ai.untools.includes(name)) return;
    const { definition, call } = tool;

    definition.function.name = name;
    tools.definition.push(definition);
    tools.calls[name] = call;
})

const targetsRegExp = new RegExp((
    [
        config.ai.key,
        config.ai.url,
        config.ai.lookai.key,
        config.ai.lookai.url,
        config.ai.fallback.key,
        config.ai.fallback.url
    ]
        .filter(k => k && k.length > 0)
        .map(k => k.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
).join('|'), 'g');

async function onCommand(uid, pack, reply) {
    if (!config.admin.includes(pack.sender.user_id))
        return reply([
            spark.msgbuilder.reply(pack.real_id),
            spark.msgbuilder.text("无权限，修改配置文件 或 星期四v我50即可获取 ovo")
        ]);

    const cmd = pack.raw_message.slice(8).split(" ");

    switch (cmd[0]) {
        case "memory": { // 记忆相关
            switch (cmd[1]) {
                case "reload": // 重载
                    memoryMap.delete(uid);
                    reply([
                        spark.msgbuilder.reply(pack.real_id),
                        spark.msgbuilder.text("记忆重载...")
                    ]);
                    break;

                case "compress": // 清理工具调用记录
                    memoryMap.delete(uid);
                    reply([
                        spark.msgbuilder.reply(pack.real_id),
                        spark.msgbuilder.text((await simpleCompress(uid)) + "")
                    ]);
                    break;

                case "delete": // 删除记忆
                    memoryMap.delete(uid);
                    try { fs.unlinkSync(path.join(memoryDir, `${uid}.json`)) } catch (e) { }
                    reply([
                        spark.msgbuilder.reply(pack.real_id),
                        spark.msgbuilder.text("记忆信息已删除..."),
                    ]);
                    break;

                case "system": { // 设置提示词
                    const memory = getMemory(uid).filter(item => item.role !== 'system');

                    if (system === "") { // 恢复默认
                        setMemory(uid, memory)
                        reply([
                            spark.msgbuilder.reply(pack.real_id),
                            spark.msgbuilder.text("提示词已恢复默认")
                        ])
                    } else {
                        setMemory(uid, [
                            {
                                role: "system",
                                content: cmd.slice(2).join(" ")
                            },
                            ...memory
                        ]);

                        reply([
                            spark.msgbuilder.reply(pack.real_id),
                            spark.msgbuilder.text("提示词已设置，将会在当前场景下生效..."),
                        ])
                    }
                    break;
                }
            }
        }

        case "tool": {
            // 输出所有工具
            if (!cmd[1])
                return reply(tools.definition.map(tool => {
                    tool = tool.function;
                    return [
                        `name: ${tool.name}`,
                        `description: ${tool.description}`,
                        `properties: ${JSON.stringify(tool.properties, null, 4)}`,
                        `required: ${JSON.stringify(tool.required)}`
                    ].join("\n");
                }))

            // 调试工具输入
            if (cmd[1] === "_debug") {
                reply([
                    `name: ${cmd[2]}`,
                    `index: ${toolsIndex.get(cmd[2])}`,
                    `output: ${JSON.stringify(toolsArgsSorting(
                        toolsIndex.get(cmd[2]), (cmd.slice(3).join(" ") || '{}')
                    ), null, 4)}`
                ].join("\n"));
                return;
            }

            // 模拟工具调用
            try {
                const toolsData = await tools.calls[cmd[1]](
                    {
                        uid: uid,
                        pack: pack,
                        config: config,
                        is_target: uid.startsWith("target_"),
                        callAPI: (...data) => reply(`"${cmd[1]}" -> callAPI:\n${JSON.stringify(data, null, 4)}`),
                        callback: (...data) => reply(`"${cmd[1]}" -> callback:\n${JSON.stringify(data, null, 4)}`),
                    }, ...toolsArgsSorting(
                        toolsIndex.get(cmd[1]), (cmd.slice(2).join(" ") || '{}')
                    )
                );

                reply((typeof toolsData === 'string'
                    ? toolsData
                    : JSON.stringify(toolsData, null, 4)
                ));
            } catch (e) {
                reply(`工具执行错误: ${e.message}`);
            }
            break;
        }

        // 查看或临时设置配置
        // AI跑的这一功能
        case "config": {
            if (cmd[1] === "set") {
                if (cmd.length < 3) return;

                try {
                    const setExpr = cmd.slice(2).join(' ').trim();
                    const eqIndex = setExpr.indexOf('=');
                    if (eqIndex === -1) return;

                    const path = setExpr.substring(0, eqIndex).trim();
                    const valueStr = setExpr.substring(eqIndex + 1).trim();

                    // 自动类型转换
                    let value;
                    try {
                        value = JSON.parse(valueStr);
                    } catch {
                        value = valueStr; // 无法解析则保持字符串
                    }

                    // 深度设置
                    const keys = path.split('.');
                    let obj = config;
                    for (let i = 0; i < keys.length - 1; i++) {
                        if (!(keys[i] in obj)) obj[keys[i]] = {};
                        obj = obj[keys[i]];
                    }
                    obj[keys[keys.length - 1]] = value;

                    reply(`>> 临时设置: ${path} = ${JSON.stringify(value)}`);
                } catch (e) {
                    reply(`>> 设置失败: ${e.message}`);
                }
                return;
            }
            if (cmd[1] === "get") {
                if (cmd.length < 3) return;

                const path = cmd.slice(2).join('.').trim();
                const keys = path.split('.');
                let obj = config;
                let valid = true;

                for (const key of keys) {
                    if (obj && typeof obj === 'object' && key in obj) {
                        obj = obj[key];
                    } else {
                        valid = false;
                        return;
                    }
                }

                if (!valid) {
                    reply(`>> 路径不存在: ${path}`);
                    return;
                }

                let value = String(
                    typeof obj === 'object'
                        ? JSON.stringify(obj, null, 4)
                        : obj
                ) ?? "";
                value = value.replace(targetsRegExp, '***')

                reply(`${path}=${value}`);
            }
            return;
        }

        default:
            return reply([
                "/aichat <mode> <...data>",
                "",
                "- memory     # 记忆相关",
                "    - reload",
                "    - compress",
                "    - delete",
                "    - system <prompt: string>",
                "",
                "- tool       # 手动调用工具",
                "    - _debug <tool_name: string> <data: json>",
                "    - <tool_name: string> <data: json>",
                "",
                "- config     # 热更改临时配置",
                "    - set <cfg: string>=<data>",
                "    - get <cfg: string>",
            ].join("\n"));
    }
}

async function onMessage(chatId, pack, reply) {
    // 防抖处理
    if (config.call.debounce.enable) {
        const ctx = getDebounceContext(chatId);
        const currentMsg = pack.raw_message || '';

        // 忽略相同内容的消息
        if (config.call.debounce.ignoreSame
            && ctx.processing
            && currentMsg === ctx.lastMsg
        ) {
            // logger.debug(`[Debounce] UID ${chatId} 忽略重复消息: ${currentMsg.substring(0, 30)}...`);
            return;
        }

        // 如果有正在处理的消息，加入缓存
        if (ctx.processing) {
            // 检查缓存是否已满
            if (ctx.cache.length >= config.call.debounce.maxCache) {
                // logger.warn(`[Debounce] UID ${chatId} 缓存已满，丢弃最旧消息`);
                ctx.cache.shift();
            }

            ctx.cache.push({ pack, reply, raw_message: currentMsg, timestamp: Date.now() });
            // logger.debug(`[Debounce] UID ${chatId} 缓存消息，当前缓存: ${ctx.cache.length}`);
            return;
        }

        // 标记为处理中
        ctx.processing = true;
        ctx.lastMsg = currentMsg;

        // 设置超时清理
        if (config.call.debounce.timeout > 0) {
            ctx.timer = setTimeout(() => {
                if (ctx.cache.length > 0) {
                    logger.warn(`[Debounce] UID ${chatId} 超时，强制处理 ${ctx.cache.length} 条缓存`);
                    while (ctx.cache.length > 0) {
                        const pending = ctx.cache.shift();
                        onMessage(chatId, pending.pack, pending.reply);
                    }
                }
                ctx.processing = false;
                ctx.timer = null;
            }, config.call.debounce.timeout);
        }
    }

    callAPI(chatId, (await formatMsg(pack)), pack, (msg, res) => {
        if (msg === "" || msg === "[false_chat]") return;

        let additionalMsg = "";

        // Token 显示
        const usage = res?.data?.usage;
        if (usage && config.reply.tokenInfo) {
            const {
                prompt_tokens,
                prompt_cache_hit_tokens,
                prompt_cache_miss_tokens,
                completion_tokens,
                total_tokens
            } = usage;

            // 一大坨的价格计算
                + (prompt_cache_hit_tokens * config.i18n.token.prompt_cache_hit_tokens)
                + (prompt_cache_miss_tokens * config.i18n.token.prompt_cache_miss_tokens)
                + (completion_tokens * config.i18n.token.completion_tokens)
                + (total_tokens - (completion_tokens
                    + prompt_cache_hit_tokens
                    + prompt_cache_miss_tokens
                ) * config.i18n.token.prompt_cache_miss_tokens);

            additionalMsg = `📊 Token消耗 (预计消耗 ${money} ¥)`
                + `\n  ├─ 输入: ${prompt_tokens}`
                + (prompt_cache_hit_tokens
                    ? `\n  │ ├─ 命中: ${prompt_cache_hit_tokens}`
                    : ""
                )
                + (prompt_cache_miss_tokens
                    ? `\n  │ └─ 未命中: ${prompt_cache_miss_tokens || 0}`
                    : ""
                )
                + `\n  ├─ 输出: ${completion_tokens}`
                + `\n  └─ 总计: ${total_tokens}`
                + `\n=================`;
        };

        // 多次回复
        if (config.reply.linebreak.enable) {
            if (data === null)
                return reply(msg);

            if (additionalMsg)
                reply(additionalMsg);

            let msgIndex = 0;
            let textToSplit = msg;
            let codeMap = null;

            if (config.reply.linebreak.codeBlock) {
                codeMap = new Map();
                textToSplit = msg.replace(/```[\s\S]*?```/g, (match) => {
                    const id = `__CODE_${codeMap.size}__`;
                    codeMap.set(id, match.replace(/```\w*\n|```$/g, ''));
                    return id;
                });
            }

            textToSplit
                .split(config.reply.linebreak.split)
                .filter(Boolean)
                .map(text => codeMap ? text.replace(/__CODE_\d+__/g, m => codeMap.get(m)) : text)
                .forEach(text => {
                    setTimeout(() => {
                        if (config.reply.CQCode)
                            reply(parseCQString.parse(text));
                        else
                            reply(text);
                    }, config.reply.linebreak.timeout * msgIndex + (text.length || 0));
                    msgIndex++
                });
        } else reply(additionalMsg + msg);
    });
}

// API 调用
async function callAPI(uid, data, pack, callback = (() => { }), canAddMemory = true, is_fullback = false) {
    if (canAddMemory) addMemory(uid, 'user', data);

    const fallbackConfig = {
        name: is_fullback ? config.ai.fallback.name : config.ai.name,
        url: is_fullback ? config.ai.fallback.url : config.ai.url,
        key: is_fullback ? config.ai.fallback.key : config.ai.key
    };

    try {
        const memoryData = getMemory(uid);
        const systemPrompt = memoryData.find(msg => msg.role === 'system')?.content || config.ai.system;

        const sendData = {
            model: fallbackConfig.name,
            max_tokens: config.ai.maxTokens,
            temperature: config.ai.temperature,
            stream: false,
            tools: tools.definition,
            tool_choice: 'auto',
            messages: [
                { role: 'system', content: systemPrompt },
                ...memoryData
            ]
        };

        if (config.debug) logger.warn("QQ -> AI:\n" + JSON.stringify(sendData, null, 4));

        const response = await axios.post(fallbackConfig.url, sendData, {
            headers: {
                'Authorization': `Bearer ${fallbackConfig.key}`,
                'Content-Type': 'application/json'
            },
            timeout: config.ai.timeout
        });

        if (retryMap.has(uid)) retryMap.delete(uid);

        if (config.debug) logger.warn("AI -> QQ:\n" + (JSON.stringify(response, (key, value) => {
            if (key === 'request' || key === 'config' || key === 'headers') return undefined;
            if (typeof value === 'bigint') return value.toString();
            return value;
        }, 4)));

        const message = response.data.choices[0].message;

        // 处理普通文本回复
        if (message.content) {
            addMemory(uid, 'assistant', message.content);
            callback(message.content, response);

            // 重置防抖
            if (config.call.debounce.enable) {
                const ctx = getDebounceContext(uid);
                ctx.processing = false;
                if (ctx.timer) {
                    clearTimeout(ctx.timer);
                    ctx.timer = null;
                }
                // 处理缓存中的下一条消息
                if (ctx.cache.length > 0)
                    processDebounceCache(uid, pack, callback);
            }
        }

        // 处理工具调用
        if (message.tool_calls && message.tool_calls.length > 0) {
            // 添加助手消息（包含工具调用）
            addMemory(uid, 'assistant', message.content || '', message.tool_calls);

            // 执行所有工具调用
            let toolResults = [];
            const chatData = {
                uid: uid,
                pack: pack,
                config: config,
                callAPI: callAPI,
                callback: callback,
                is_target: uid.startsWith("target_")
                // 以后想到了再加...
            };

            for (const toolCall of message.tool_calls) {
                const toolName = toolCall.function.name;
                const toolArgs = toolsArgsSorting(
                    toolsIndex.get(toolName), (toolCall.function.arguments || '{}')
                );

                // 执行工具
                let toolResult = null;
                if (tools.calls[toolName]) {
                    try {
                        toolResult = await Promise.resolve(
                            tools.calls[toolName](chatData, ...toolArgs)
                        );
                        toolResult = typeof toolResult === 'string' ? toolResult : JSON.stringify(toolResult);
                    } catch (e) {
                        toolResult = `工具执行错误: ${e.message}`;
                        logger.error(`[QQAIChatEx] 工具 ${toolName} 执行失败: ${e}`);
                    }
                } else {
                    toolResult = `未知工具: ${toolName}`;
                }

                toolResults.push({
                    role: 'tool',
                    tool_call_id: toolCall.id,
                    content: toolResult
                });
            }

            // 添加工具结果到记忆
            toolResults = toolResults ?? "[null]";
            toolResults.forEach(result => addMemory(uid, result.role, result.content, null, result.tool_call_id));

            // 递归调用继续对话（不重复添加用户消息）
            if (message.content) callback(message.content, response);
            return callAPI(uid, data, pack, callback, false);
        }
    } catch (e) {
        logger.error(replaceMsg(config.i18n.error.logger, {
            code: config.i18n.error.code[e.response.status] ?? e.response?.status,
            err: e
        }));
        const retry = retryMap.get(uid) ?? 0;
        if (retry < (config.ai.retry ?? 0)) {
            retryMap.set(uid, retry + 1);
            if (config.ai.errorMsg)
                callback(replaceMsg(`\`\`\`${config.i18n.error.retry}\`\`\``, {
                    retry: retry + 1,
                    maxRetry: config.ai.retry,
                    code: config.i18n.error.code[e.response?.status] ?? e.response?.status,
                    err: e.message
                }));
            return callAPI(uid, data, pack, callback, false);
        }
        if (!is_fullback && config.ai.fallback.enable) {
            if (config.ai.errorMsg)
                callback(replaceMsg(`\`\`\`${config.i18n.error.fullback}\`\`\``, {
                    name: config.ai.fallback.name,
                    code: config.i18n.error.code[e.response?.status] ?? e.response?.status,
                    err: e.message
                }), null);
            return callAPI(uid, data, pack, callback, false, true);
        }

        // 重置防抖
        if (config.call.debounce.enable) {
            const ctx = getDebounceContext(uid);
            ctx.processing = false;
            if (ctx.timer) {
                clearTimeout(ctx.timer);
                ctx.timer = null;
            }
            // 处理缓存中的下一条消息
            if (ctx.cache.length > 0)
                processDebounceCache(uid, pack, callback);

        }

        if (config.ai.errorMsg)
            callback(replaceMsg(`\`\`\`${config.i18n.error.error}\`\`\``, {
                code: config.i18n.error.code[e.response?.status] ?? e.response?.status,
                err: e.message
            }), null);
    }
}

/// ====== 一些工具函数 ====== ///

// === 防抖模块 === //
function getDebounceContext(uid) {
    if (!debounceMap.has(uid)) {
        debounceMap.set(uid, {
            timer: null,
            cache: [],
            processing: false,
            lastMsg: ''
        });
    }
    return debounceMap.get(uid);
}

function processDebounceCache(uid, pack, reply) {
    const ctx = getDebounceContext(uid);
    if (ctx.timer) {
        clearTimeout(ctx.timer);
        ctx.timer = null;
    }

    if (ctx.cache.length === 0) {
        ctx.processing = false;
        return;
    }

    // 取出最早的一条缓存消息
    const cached = ctx.cache.shift();
    ctx.processing = true;
    ctx.lastMsg = cached.raw_message;

    // 发送缓存消息
    onMessage(uid, cached.pack, cached.reply);

    // 设置超时清理
    if (config.call.debounce.timeout > 0) {
        ctx.timer = setTimeout(() => {
            if (ctx.cache.length > 0) {
                if (config.debug)
                    logger.warn(`UID ${uid} 超时，强制处理 ${ctx.cache.length} 条缓存`);
                while (ctx.cache.length > 0) {
                    const pending = ctx.cache.shift();
                    onMessage(uid, pending.pack, pending.reply);
                }
            }
            ctx.processing = false;
            ctx.timer = null;
        }, config.call.debounce.timeout);
    }
}

// 工具输入参数排序
function toolsArgsSorting(tool, args) {
    const order = tool || [];
    const parsed = typeof args === 'string' ? JSON.parse(args) : args;

    // 直接按顺序构建数组
    const result = [];
    const usedKeys = new Set();

    // 按顺序添加
    for (const key of order) {
        if (key in parsed) {
            result.push(parsed[key]);
            usedKeys.add(key);
        }
    }

    // 添加未在顺序中的参数（保持原始顺序）
    for (const key in parsed) {
        if (!usedKeys.has(key)) {
            result.push(parsed[key]);
            usedKeys.add(key);
        }
    }

    return result; // 直接返回数组
}

// 去除一些函数
function cleanTools(tools, untools) {
    // 删除 calls 中的属性
    untools.forEach(name => {
        delete tools.calls[name];
    });

    // 过滤 definition 数组
    tools.definition = tools.definition.filter(
        def => !untools.includes(def.function.name)
    );

    return tools;
}

// 翻译语句
function replaceMsg(text, data) {
    return text.replace(
        /%(\w+)/g,
        (_, key) => data[key] ?? `%${key}`
    );
}

// ==== 记忆管理相关 ==== //

// 获取记忆
function getMemory(uid) {
    if (memoryMap.has(uid)) return memoryMap.get(uid);

    const filePath = path.join(memoryDir, `${uid}.json`);
    let memory = [];

    if (fs.existsSync(filePath)) {
        try {
            const content = fs.readFileSync(filePath, 'utf8').trim();
            if (content) memory = JSON.parse(content);
        } catch (e) {
            logger.error(`[QQAIChatEx] 读取记忆文件失败: ${filePath}`, e.message);
        }
    }

    // 合并连续的 user 和 assistant 消息（核心逻辑）
    const merged = memory.reduce((acc, msg) => {
        const last = acc[acc.length - 1];

        // 合并连续的 user 消息
        if (msg.role === 'user' && last && last.role === 'user') {
            const prevContent = last.content;
            const currContent = msg.content;

            // 提取所有文本并合并
            const prevTexts = Array.isArray(prevContent)
                ? prevContent.filter(item => item.type === 'text').map(item => item.text)
                : [String(prevContent)];

            const currTexts = Array.isArray(currContent)
                ? currContent.filter(item => item.type === 'text').map(item => item.text)
                : [String(currContent)];

            // 合并为单条文本
            const mergedText = [...prevTexts, ...currTexts].join('\n');
            last.content = [{ type: 'text', text: mergedText }];
        }
        // 合并连续的 assistant 消息
        else if (msg.role === 'assistant' && last && last.role === 'assistant') {
            // 合并 content
            const prevContent = last.content || '';
            const currContent = msg.content || '';
            last.content = prevContent + '\n\n' + currContent;

            // 合并 tool_calls
            if (msg.tool_calls && msg.tool_calls.length > 0) {
                if (!last.tool_calls) {
                    last.tool_calls = [];
                }
                // 将新的 tool_calls 添加到已有的后面
                last.tool_calls = [...last.tool_calls, ...msg.tool_calls];

                // 重新索引 tool_calls（可选，保持索引连续）
                last.tool_calls.forEach((tc, index) => {
                    tc.index = index;
                });
            }
        }
        else {
            acc.push({ ...msg });
        }
        return acc;
    }, []);

    memoryMap.set(uid, merged);
    return merged;
}

// 设置记忆
function setMemory(uid, data) {
    if (!Array.isArray(data))
        return false;

    memoryMap.set(uid, data);
    fs.writeFile(
        path.join(memoryDir, `${uid}.json`),
        JSON.stringify(data, null, 2),
        () => { }
    );
}


// 添加记忆
function addMemory(uid, role, content, tool_calls = null, tool_call_id = null) {
    let memory = getMemory(uid);
    if (!Array.isArray(memory)) {
        memory = [];
        memoryMap.set(uid, memory);
    }

    const message = { role, content };
    if (tool_calls) message.tool_calls = tool_calls;
    if (tool_call_id) message.tool_call_id = tool_call_id;

    memory.push(message);

    // 超出时备份并裁剪
    // === 修改处：计算非 system 消息数量 === //
    const normalCount = memory.filter(msg => msg.role !== 'system').length;
    if (normalCount > config.memory.length) {
        if (config.memory.bak) {
            // 备份时排除 system 消息
            const normalMemory = memory.filter(msg => msg.role !== 'system');
            const removed = normalMemory.slice(0, normalCount - config.memory.length);
            const bakPath = path.join(memoryBakDir, `${uid}.json`);
            let bak = [];
            if (fs.existsSync(bakPath)) bak = JSON.parse(fs.readFileSync(bakPath, 'utf8'));
            bak.push(...removed);
            fs.writeFileSync(bakPath, JSON.stringify(bak, null, 2), () => { });
        }

        // 安全裁剪（自动保留 system）
        memory = safeSlice(memory, config.memory.length);
        memoryMap.set(uid, memory);
    }

    const filePath = path.join(memoryDir, `${uid}.json`);
    fs.writeFile(filePath, JSON.stringify(memory, null, 2), () => { });

    return memory;
}

// 安全裁剪：保持消息完整性
function safeSlice(memory, maxLength) {
    // === 修改处：提取 system 消息 === //
    const systemMsg = memory.find(msg => msg.role === 'system');
    const normalMemory = memory.filter(msg => msg.role !== 'system');

    if (normalMemory.length <= maxLength) {
        return memory; // 不需要裁剪
    }

    // 对普通消息进行裁剪
    let sliced = normalMemory.slice(-maxLength);

    // 检查第一条保留的消息是否是孤立的 tool 消息
    if (sliced.length > 0 && sliced[0].role === 'tool' && sliced[0].tool_call_id) {
        const startIndex = normalMemory.length - maxLength;
        for (let i = startIndex - 1; i >= 0; i--) {
            if (normalMemory[i].role === 'assistant' &&
                normalMemory[i].tool_calls?.some(tc => tc.id === sliced[0].tool_call_id)) {
                const realKeep = normalMemory.slice(i);
                sliced = realKeep.slice(-maxLength - 1);
                break;
            }
        }
        if (sliced.length > 0 && sliced[0].role === 'tool') {
            sliced = sliced.slice(1);
        }
    }

    // 检查是否需要移除孤立的 tool 消息
    if (normalMemory.length > maxLength) {
        const removedAssistant = normalMemory[normalMemory.length - maxLength - 1];
        if (removedAssistant?.role === 'assistant' && removedAssistant.tool_calls) {
            const toolIds = new Set(removedAssistant.tool_calls.map(tc => tc.id));
            sliced = sliced.filter(msg =>
                !(msg.role === 'tool' && toolIds.has(msg.tool_call_id))
            );
        }
    }

    // === 修改处：将 system 消息放回最前面 === //
    return systemMsg ? [systemMsg, ...sliced] : sliced;
}

// === 格式化消息相关 === //

async function formatMsg(pack, mode = 0) {
    if (mode === 0) { // 输入消息 (QQ -> AI)
        const qid = pack.sender.user_id;
        const name = pack.sender.card || pack.sender.nickname || qid;
        let msg = pack.message;

        msg = await Promise.all(
            msg.map(async (t) => {
                switch (t.type) {
                    case 'text': {
                        return {
                            type: "text",
                            text: t.data.text
                        };
                    }
                    case 'at': {
                        return {
                            type: "text",
                            text: `@${(await getUserName(pack.group_id, t.data.qq))}`
                        };
                    }
                    case 'image': {
                        if (!config.input.type.image) return { type: "text", text: `[type=image,URL=${t.data.url}]` };
                        return {
                            type: "image_url",
                            image_url: {
                                url: t.data.url,
                                detail: "auto"
                            }
                        };
                    }
                    case 'audio': {
                        if (!config.input.type.audio) return { type: "text", text: `[type=audio,URL=${t.data.url}]` };
                        return {
                            type: "audio_url",
                            audio_url: {
                                url: t.data.url
                            }
                        };
                    }
                    case 'video': {
                        if (!config.input.type.video) return { type: "text", text: `[type=video,URL=${t.data.url}]` };
                        return {
                            type: "video_url",
                            video_url: {
                                url: t.data.url,
                                detail: "auto",
                                max_frames: 16,
                                fps: 1
                            }
                        };
                    }
                    case 'reply': {
                        const replyPack = await spark.QClient.getMsg(t.data.id);
                        return {
                            type: "text",
                            text: `---引用消息(CQ码)\n${replyPack.raw_message
                                .replace(/&#44;/g, ',')
                                .replace(/&amp;/g, '&')
                                .replace(/&#91;/g, '[')
                                .replace(/&#93;/g, ']')
                                }\n---`
                        }
                    }
                    case 'face': {
                        return {
                            type: "text",
                            text: `[type=face,id=${t?.data?.id},text=${t?.data?.raw?.faceText}]`
                        }
                    }
                    default:
                        return {
                            type: "text",
                            text: JSON.stringify(t)
                        }
                }
            })
        );

        if (config.input.msgFormat) {
            msg = [
                {
                    type: "text",
                    text: ` [${new Date().toLocaleString('zh-CN', { hour12: false })}][${name}(${qid})] >> `
                },
                ...msg
            ]
        }

        msg = mergeText(msg, (textBuffer) => {
            return {
                type: "text",
                text: textBuffer.map(t => t.text).join('')
            };
        });

        return msg.filter(i => i !== undefined);
    } else if (mode === 1) { // 输出消息 (AI -> QQ)

    }
}

// 合并连续的文本
function mergeText(messages, mergeFn) {
    const result = [];
    let textBuffer = [];

    for (const msg of messages) {
        if (msg.type === 'text') {
            // 文本类型：放入缓冲区
            textBuffer.push(msg);
        } else {
            // 非文本类型：先清空缓冲区，再添加当前元素
            if (textBuffer.length > 0) {
                result.push(mergeFn(textBuffer));
                textBuffer = [];
            }
            result.push(msg);
        }
    }

    // 处理最后可能残留的文本缓冲
    if (textBuffer.length > 0)
        result.push(mergeFn(textBuffer));
    return result;
}

// 获取用户名称
async function getUserName(groupId, userId) {
    try {
        const info = await spark.QClient.getGroupMemberInfo(groupId, userId);
        return (info.card || info.nickname || `${userId}`);
    } catch (e) {
        return `${userId}`;
    }
}

// === 对话压缩 === //

// 简单压缩：移除工具调用对
function simpleCompress(uid) {
    const memory = getMemory(uid);
    if (!memory || memory.length === 0) return memory;

    const compressed = [];
    const toRemoveIds = new Set();

    // 标记所有需要移除的 tool_call_id
    for (let i = 0; i < memory.length; i++) {
        const msg = memory[i];
        if (msg.role === 'assistant' && msg.tool_calls) {
            // 标记该助手消息本身
            toRemoveIds.add(i);
            // 标记对应的 tool 消息
            for (const toolCall of msg.tool_calls) {
                for (let j = i + 1; j < memory.length; j++) {
                    if (memory[j].role === 'tool' && memory[j].tool_call_id === toolCall.id) {
                        toRemoveIds.add(j);
                        break;
                    }
                }
            }
        }
    }

    // 构建压缩后的记忆
    for (let i = 0; i < memory.length; i++) {
        if (!toRemoveIds.has(i)) {
            compressed.push(memory[i]);
        }
    }

    // 更新记忆
    memoryMap.set(uid, compressed);
    const filePath = path.join(memoryDir, `${uid}.json`);
    fs.writeFileSync(filePath, JSON.stringify(compressed, null, 2), () => { });

    return `简单压缩完成: ${memory.length} -> ${compressed.length} 条消息`;
}