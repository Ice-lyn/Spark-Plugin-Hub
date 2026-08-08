const axios = require('axios');

const tools = {
    // 发送卡片
    "send_music_card": {
        definition: {
            type: "function",
            function: {
                description: "发送第三方音乐卡片消息;虽然说是音乐卡片，但是你可以用它的结构发任何东西",
                parameters: {
                    type: "object",
                    properties: {
                        type: {
                            type: "string",
                            description: "平台",
                        },
                        title: {
                            type: "string",
                            description: "标题",
                        },
                        content: {
                            type: "string",
                            description: "内容",
                        },
                        image: {
                            type: "string",
                            description: "外显图片",
                        },
                        url: {
                            type: "string",
                            description: "跳转URL",
                        },
                        audio: {
                            type: "string",
                            description: "[可选] 音频",
                        }
                    },
                    required: ["type", "title", "content", "image", "url"]
                }
            }
        },
        call: async (chatData, type = "qq", title = "", content = "", image = "", url = "", audio = null) => {
            const res = await axios.post("https://ss.xingzhige.com/music_card/card", {
                type, title, content, image, url, ...audio ? { audio } : {}
            }, {
                headers: { 'Content-Type': 'application/json;charset=utf-8' },
                timeout: 15000
            });

            const msg = {
                type: 'json',
                data: {
                    data: JSON.stringify(res.data)
                }
            };

            chatData.uid.startsWith("target_")
                ? spark.QClient.sendPrivateMsg(chatData.uid.slice(7), msg)
                : spark.QClient.sendGroupMsg(chatData.uid, msg);

            return "卡片信息已尝试发送";
        }
    },

    // 外置视觉模型
    "look_image_info": {
        definition: {
            type: "function",
            function: {
                description: "调用外置视觉模型分析图片内容，一次一张图片",
                parameters: {
                    type: "object",
                    properties: {
                        url: {
                            type: "string",
                            description: "图片url",
                        },
                        prompt: {
                            type: "string",
                            description: "对视觉模型的提问词，应当明确要求，避免让模型返回过多文字",
                        },
                    },
                    required: ["url", "prompt"]
                }
            }
        },
        call: async (chatData, url, prompt) => {
            if (!chatData.config.ai.lookai.enable)
                return "视觉模型未启用";

            try {
                const lookai = chatData.config.ai.lookai;
                const data = await axios.post(lookai.url, {
                    model: lookai.name,
                    messages: [
                        {
                            role: "user", content: [
                                {
                                    "type": "text",
                                    "text": prompt
                                },
                                {
                                    type: "image_url",
                                    image_url: {
                                        url: url
                                    }
                                }
                            ]
                        }
                    ]
                }, {
                    headers: {
                        'Authorization': `Bearer ${lookai.key}`,
                        'Content-Type': 'application/json'
                    },
                    timeout: 100000
                });
                return data.data.choices ?? JSON.stringify(data, (key, value) => {
                    if (key === 'request' || key === 'config' || key === 'headers') return undefined;
                    if (typeof value === 'bigint') return value.toString();
                    return value;
                });
            } catch (e) {
                return `分析失败，可尝试再次调用此工具，最多可尝试10次\n${e}`;
            }
        }
    },

    // 语音合成
    "send_ai_tts_msg": {
        definition: {
            type: "function",
            function: {
                description: "合成AI声聊语音消息并发送至当前群聊，不支持私聊，有AI提示",
                parameters: {
                    type: "object",
                    properties: {
                        text: {
                            type: "string",
                            description: "要合成的文本",
                        }
                    },
                    required: ["text"]
                }
            }
        },
        call: async (chatData, text) => {
            if (chatData.is_target) return "私聊场景下无法调用该工具";
            return await request("send_group_ai_record", {
                character: "lucy-voice-f38",
                group_id: chatData.uid,
                text: text
            })
        }
    },

    // 发送WS原始数据包
    "send_ws_pack": {
        definition: {
            type: "function",
            function: {
                description: "发送NapCat的WS原始数据包，如果你不会用请不要调用，这可能导致程序崩溃",
                parameters: {
                    type: "object",
                    properties: {
                        action: {
                            type: "string",
                            description: "动作",
                        },
                        params: {
                            type: "string",
                            description: "动作内部数据，JSON对象格式",
                        },
                    },
                    required: ["action", "params"]
                }
            }
        },
        call: async (chatData, action, params, key = null) => {
            if (key == null) return "No permission";
            return await request(action, JSON.parse(params))
        }
    },

    // 发送截一截消息
    "send_poke": {
        definition: {
            type: "function",
            function: {
                description: "截一截用户以示友好，通常在信息发送完成后调用",
                parameters: {
                    type: "object",
                    properties: {
                        qq: {
                            type: "string",
                            description: "对方QQ号",
                        }
                    },
                    required: ["qq"]
                }
            }
        },
        call: async (chatData, qq) => {
            let msg = "";

            if (chatData.is_target) {
                msg = await request('friend_poke', {
                    user_id: chatData.uid.slice(7)
                });
            } else {
                msg = await request('group_poke', {
                    group_id: chatData.uid,
                    user_id: qq
                });
            }

            return msg;
        }
    },

    // 查询群聊人员列表
    "query_group_member_list": {
        definition: {
            type: "function",
            function: {
                description: "查询当前群聊人员列表",
                parameters: {
                    type: "object",
                    properties: {},
                    required: []
                }
            }
        },
        call: async (chatData) => {
            if (chatData.is_target)
                return "当前为私聊环境，无需查询";

            let data = await request("get_group_member_list", {
                group_id: chatData.uid
            })

            data = data.data;
            return data.map((user) => {
                return {
                    user_id: user.user_id,
                    nickname: user.nickname,
                    card: user.card,
                    level: user.level,
                    role: user.role,
                    title: user.title,
                    join_time: user.join_time,
                    last_sent_time: user.last_sent_time,
                    is_robot: user.is_robot,
                    shut_up_timestamp: user.shut_up_timestamp
                }
            })
        }
    },

    // 查询用户信息
    "query_user_info": {
        definition: {
            type: "function",
            function: {
                description: "需要查询用户信息时调用",
                parameters: {
                    type: "object",
                    properties: {
                        qq: {
                            type: "string",
                            description: "被查询者QQ号",
                        },
                        all: {
                            type: 'boolean',
                            description: '是否返回完整数据；完整数据通常很大，默认选择false',
                            default: false
                        }
                    },
                    required: ["qq", "all"]
                }
            }
        },
        call: async (chatData, qq, all) => {
            let data = await request('get_stranger_info', {
                user_id: chatData.uid.slice(7),
                no_cache: true
            });

            if (all) return data.data;

            data = data.data;
            return {
                qq: data.uin,
                name: data.nick,
                remark: data.remark,
                sex: data.sex,
                age: data.age,
                longNick: data.longNick,
                qqLevel: data.qqLevel,
                richTime: data.richTime,
                birthday: `${data.birthday_year}-${data.birthday_month}-${data.birthday_day}`,
                address: `${data.country}-${data.province}-${data.city}`
            }
        }
    },

    // 知识库
    "query_knowledge_data": {
        definition: {
            type: "function",
            function: {
                description: "当用户询问特定知识时，调用此工具查询相关信息，确保关键词简洁，如空返回可再次调用",
                parameters: {
                    type: "object",
                    properties: {
                        query: {
                            type: "string",
                            description: "要搜索的关键词;输入 all 获取所有;可使用空格分隔多个关键词",
                        }
                    },
                    required: ["query"]
                }
            }
        },
        call: async (chatData, query) => {
            return await chatData.config.ai.knowledge(query);
        }
    },

    // 获取聊天记录
    "query_chat_data": {
        definition: {
            type: 'function',
            function: {
                description: '获取当前对话的历史消息记录。可以获取最近的消息，支持自定义数量和排序方向。',
                parameters: {
                    type: 'object',
                    properties: {
                        count: {
                            type: 'integer',
                            description: '要获取的消息数量，默认10条，最大为400',
                            default: 10,
                            minimum: 1,
                            maximum: 400
                        },
                        reverseOrder: {
                            type: 'boolean',
                            description: '消息排序方向。true=从旧到新（最早的消息在前），false=从新到旧（最新的消息在前）',
                            default: false
                        }
                    },
                    required: ["count", "reverseOrder"]
                }
            }
        },
        call: async (chatData, count = 10, reverseOrder = false) => {
            count = +count;
            reverseOrder = Boolean(reverseOrder);

            try {
                let msgList = {};

                if (chatData.is_target) {
                    msgList = await request('get_friend_msg_history', {
                        user_id: chatData.uid.slice(7),
                        message_seq: 0,
                        count: count,
                        reverseOrder: reverseOrder
                    });
                } else {
                    msgList = await request('get_group_msg_history', {
                        group_id: chatData.uid,
                        count: count,
                        reverseOrder: reverseOrder
                    });
                }

                // 批量处理
                msgList = msgList?.data?.messages?.map(msg => {
                    if (msg?.message?.[0]?.data?.text?.startsWith("📊 Token消耗")) return;
                    const timeStr = (new Date(msg.time * 1000)).toLocaleString();
                    const sender = msg.sender.card || msg.sender.nickname;
                    return `[${timeStr}][${sender} (${msg.sender.user_id})] >> ${msg.raw_message}`;
                });

                return JSON.stringify(msgList, (key, value) => {
                    if (key === 'request' || key === 'config' || key === 'headers') return undefined;
                    if (typeof value === 'bigint') return value.toString();
                    return value;
                }) ?? "null";

            } catch (error) {
                logger.error(`获取聊天记录失败: ${error.message}`);
                return "null";
            }
        }
    }
};

// === 辅助函数 === //
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

module.exports = ((tools) => {
    const result = { definition: [], calls: {} };
    for (const [name, tool] of Object.entries(tools)) {
        const def = JSON.parse(JSON.stringify(tool.definition));
        def.function.name = name;
        result.definition.push(def);
        result.calls[name] = tool.call;
    }
    return result;
})(tools);