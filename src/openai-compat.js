import crypto from 'crypto';

function parseJsonSafe(value) {
    if (typeof value !== 'string') return value;
    try {
        return JSON.parse(value);
    } catch {
        return { raw: value };
    }
}

function normalizeContentToText(content) {
    if (typeof content === 'string') return content;
    if (!Array.isArray(content)) return '';

    const parts = [];
    for (const item of content) {
        if (!item || typeof item !== 'object') continue;
        if (item.type === 'text' && typeof item.text === 'string') {
            parts.push(item.text);
            continue;
        }
        if (item.type === 'input_text' && typeof item.text === 'string') {
            parts.push(item.text);
        }
    }

    return parts.join('\n');
}

export function openAiToAnthropicRequest(body) {
    const messages = [];
    const systemParts = [];

    for (const msg of body.messages || []) {
        const role = msg?.role || 'user';

        if (role === 'system') {
            const txt = normalizeContentToText(msg.content);
            if (txt) systemParts.push(txt);
            continue;
        }

        if (role === 'tool') {
            messages.push({
                role: 'user',
                content: [
                    {
                        type: 'tool_result',
                        tool_use_id: msg.tool_call_id || `toolu_${crypto.randomBytes(12).toString('hex')}`,
                        content: typeof msg.content === 'string' ? msg.content : normalizeContentToText(msg.content)
                    }
                ]
            });
            continue;
        }

        if (role === 'assistant' && Array.isArray(msg.tool_calls) && msg.tool_calls.length > 0) {
            const blocks = [];
            const text = normalizeContentToText(msg.content);
            if (text) {
                blocks.push({ type: 'text', text });
            }

            for (const tc of msg.tool_calls) {
                blocks.push({
                    type: 'tool_use',
                    id: tc.id || `toolu_${crypto.randomBytes(12).toString('hex')}`,
                    name: tc?.function?.name || 'tool',
                    input: parseJsonSafe(tc?.function?.arguments || '{}') || {}
                });
            }

            messages.push({ role: 'assistant', content: blocks.length > 0 ? blocks : [{ type: 'text', text: '' }] });
            continue;
        }

        const text = normalizeContentToText(msg.content);
        messages.push({ role: role === 'assistant' ? 'assistant' : 'user', content: text });
    }

    const tools = Array.isArray(body.tools)
        ? body.tools
              .filter(t => t?.function?.name)
              .map(t => ({
                  name: t.function.name,
                  description: t.function.description || '',
                  input_schema: t.function.parameters || { type: 'object', properties: {} }
              }))
        : undefined;

    let toolChoice;
    if (typeof body.tool_choice === 'string') {
        if (body.tool_choice === 'required') toolChoice = { type: 'any' };
        else if (body.tool_choice === 'none') toolChoice = { type: 'none' };
        else toolChoice = { type: 'auto' };
    } else if (body.tool_choice?.type === 'function' && body.tool_choice?.function?.name) {
        toolChoice = { type: 'tool', name: body.tool_choice.function.name };
    }

    return {
        model: body.model,
        messages,
        stream: !!body.stream,
        system: systemParts.length > 0 ? systemParts.join('\n\n') : undefined,
        max_tokens: typeof body.max_tokens === 'number' ? body.max_tokens : 4096,
        temperature: typeof body.temperature === 'number' ? body.temperature : undefined,
        top_p: typeof body.top_p === 'number' ? body.top_p : undefined,
        tools,
        tool_choice: toolChoice
    };
}

function stopReasonToFinishReason(stopReason, hasToolCalls = false) {
    if (hasToolCalls || stopReason === 'tool_use') return 'tool_calls';
    if (stopReason === 'max_tokens') return 'length';
    return 'stop';
}

export function anthropicToOpenAiChatResponse(resp) {
    const content = Array.isArray(resp?.content) ? resp.content : [];
    const text = content.filter(b => b?.type === 'text').map(b => b.text || '').join('');

    const toolCalls = content
        .filter(b => b?.type === 'tool_use')
        .map(b => ({
            id: b.id || `call_${crypto.randomBytes(8).toString('hex')}`,
            type: 'function',
            function: {
                name: b.name || 'tool',
                arguments: JSON.stringify(b.input || {})
            }
        }));

    const finishReason = stopReasonToFinishReason(resp?.stop_reason, toolCalls.length > 0);
    const usage = resp?.usage || {};

    return {
        id: `chatcmpl_${crypto.randomBytes(12).toString('hex')}`,
        object: 'chat.completion',
        created: Math.floor(Date.now() / 1000),
        model: resp?.model,
        choices: [
            {
                index: 0,
                message: {
                    role: 'assistant',
                    content: text,
                    ...(toolCalls.length > 0 ? { tool_calls: toolCalls } : {})
                },
                finish_reason: finishReason
            }
        ],
        usage: {
            prompt_tokens: usage.input_tokens || 0,
            completion_tokens: usage.output_tokens || 0,
            total_tokens: (usage.input_tokens || 0) + (usage.output_tokens || 0)
        }
    };
}

export function createChatStreamState(model) {
    return {
        id: `chatcmpl_${crypto.randomBytes(12).toString('hex')}`,
        created: Math.floor(Date.now() / 1000),
        model,
        emittedStart: false
    };
}

export function anthropicEventToOpenAiChatChunk(event, state) {
    if (!state.emittedStart) {
        state.emittedStart = true;
        return {
            id: state.id,
            object: 'chat.completion.chunk',
            created: state.created,
            model: state.model,
            choices: [{ index: 0, delta: { role: 'assistant' }, finish_reason: null }]
        };
    }

    if (event?.type === 'content_block_delta' && event?.delta?.type === 'text_delta') {
        return {
            id: state.id,
            object: 'chat.completion.chunk',
            created: state.created,
            model: state.model,
            choices: [{ index: 0, delta: { content: event.delta.text || '' }, finish_reason: null }]
        };
    }

    if (event?.type === 'message_delta') {
        return {
            id: state.id,
            object: 'chat.completion.chunk',
            created: state.created,
            model: state.model,
            choices: [{ index: 0, delta: {}, finish_reason: stopReasonToFinishReason(event?.delta?.stop_reason) }]
        };
    }

    return null;
}

export function openAiResponsesInputToChatMessages(input) {
    if (typeof input === 'string') {
        return [{ role: 'user', content: input }];
    }

    if (!Array.isArray(input)) {
        return [{ role: 'user', content: '' }];
    }

    const out = [];
    for (const item of input) {
        if (!item) continue;

        if (item.type === 'message') {
            out.push({
                role: item.role || 'user',
                content: normalizeContentToText(item.content)
            });
            continue;
        }

        if (item.role) {
            out.push({ role: item.role, content: normalizeContentToText(item.content) });
            continue;
        }
    }

    return out.length > 0 ? out : [{ role: 'user', content: '' }];
}

export function chatResponseToResponsesResponse(chatResp) {
    const msg = chatResp?.choices?.[0]?.message || {};
    const usage = chatResp?.usage || {};

    return {
        id: `resp_${crypto.randomBytes(12).toString('hex')}`,
        object: 'response',
        created_at: Math.floor(Date.now() / 1000),
        status: 'completed',
        model: chatResp?.model,
        output: [
            {
                id: `msg_${crypto.randomBytes(10).toString('hex')}`,
                type: 'message',
                role: 'assistant',
                content: [
                    {
                        type: 'output_text',
                        text: msg.content || ''
                    }
                ]
            }
        ],
        output_text: msg.content || '',
        usage: {
            input_tokens: usage.prompt_tokens || 0,
            output_tokens: usage.completion_tokens || 0,
            total_tokens: usage.total_tokens || 0
        }
    };
}

export function openAiError(message, type = 'api_error', code = null) {
    return {
        error: {
            message,
            type,
            ...(code ? { code } : {})
        }
    };
}
