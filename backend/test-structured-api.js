#!/usr/bin/env node
// Quick API test — sends structured mode queries to the chat API
// Tests that the structured plan is generated correctly end-to-end

const API_KEY = 'sk-167b24c7a13243eda13a2da11b783aa4';
const BASE_URL = 'http://localhost:3000';

async function testStructuredMode(query) {
  console.log(`\n=== Testing "${query}" with structured mode ===`);

  const res = await fetch(`${BASE_URL}/api/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      message: query,
      depth: 'structured',
      style: 'dossier',
      config: {
        apiKey: API_KEY,
        baseUrl: 'https://api.deepseek.com',
        model: 'deepseek-v4-pro',
        protocol: 'openai',
        maxRounds: 20,
      }
    })
  });

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let planFound = false;
  let toolCalls = [];
  let totalChars = 0;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop() || '';
    for (const line of lines) {
      if (!line.startsWith('data: ')) continue;
      try {
        const event = JSON.parse(line.slice(6));
        totalChars += (event.text || '').length;

        if (event.type === 'tool_start') {
          toolCalls.push({ name: event.name, id: event.tool_call_id });
        }
        if (event.type === 'tool_end') {
          const call = toolCalls.find(c => c.id === event.tool_call_id);
          if (call) call.result = event.result?.slice(0, 200);
          if (event.name === 'lore_search_plan') {
            planFound = true;
            const result = JSON.parse(event.result || '{}');
            console.log(`  Plan mode: ${result.mode || 'unknown'}`);
            console.log(`  Sessions: ${result.session_id ? 'yes' : 'no'}`);
            console.log(`  Subtasks: ${result.subtasks?.length || 0}`);
            if (result.subtasks) {
              for (const s of result.subtasks) {
                console.log(`    - ${s.title} [${s.read_strategy || 'query_hits'}]`);
              }
            }
            console.log(`  Document distribution: ${result.document_distribution?.total_series || 0} series, ${result.document_distribution?.total_anchors || 0} anchors`);
          }
        }
        if (event.type === 'done') {
          // Ignore
        }
        if (event.type === 'error') {
          console.log(`  ERROR: ${event.message}`);
        }
      } catch {}
    }
  }

  return { planFound, toolCalls: toolCalls.length, totalChars };
}

async function main() {
  const queries = ['莱茵生命', '塞雷娅'];

  for (const query of queries) {
    try {
      const result = await testStructuredMode(query);
      console.log(`  Tool calls: ${result.toolCalls}, Plan found: ${result.planFound}, Response chars: ${result.totalChars}`);
    } catch(e) {
      console.log(`  FAILED: ${e.message}`);
    }
  }
}

main().catch(console.error);
