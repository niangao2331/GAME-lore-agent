#!/usr/bin/env node
// Structured mode inference test with 销钉 (thought-peg) detection
import { readFileSync, writeFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const apiContent = readFileSync(join(__dirname, '..', 'API.txt'), 'utf-8');
const lines = apiContent.split('\n').filter(Boolean);
const [model, apiKey, baseUrl] = [lines[0].trim(), lines[1].trim(), lines[2].trim()];

const PASS_MARKERS = ['销钉', '灰质销钉', '思想植入', '思想钢印'];
const PRINCIPLE_MARKERS = ['记忆', '意识', '植入', '背叛', '惩罚', '前文明', '普瑞赛斯'];

async function test(mode) {
  const res = await fetch('http://localhost:3000/api/chat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      message: '预言家为什么背叛特蕾西娅', depth: mode, style: 'dossier',
      config: { apiKey, baseUrl, model, protocol: 'openai', maxRounds: 25, roundDelayMs: 0 },
    })
  });
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buf = '', text = '', tools = 0, planGen = false;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    const ls = buf.split('\n'); buf = ls.pop() || '';
    for (const line of ls) {
      if (!line.startsWith('data: ')) continue;
      try {
        const e = JSON.parse(line.slice(6));
        if (e.type === 'delta') text += e.text;
        if (e.type === 'tool_start') tools++;
        if (e.type === 'tool_end' && e.name === 'lore_search_plan') planGen = true;
      } catch {}
    }
  }
  const passMarkers = PASS_MARKERS.filter(m => text.includes(m));
  const principleMarkers = PRINCIPLE_MARKERS.filter(m => text.includes(m));
  return {
    mode, tools, chars: text.length, planGen,
    pass: passMarkers.length >= 1,
    passMarkers, principleMarkers,
    preview: text.slice(0, 400)
  };
}

async function main() {
  console.log('=== 销钉 DETECTION TEST (keywords only, no API dispatch) ===\n');
  const results = [];
  for (const mode of ['structured']) {
    process.stdout.write(`[${mode}] `);
    try {
      const r = await test(mode);
      results.push(r);
      console.log(`tools=${r.tools} chars=${r.chars} plan=${r.planGen}`);
      console.log(`  PASS: ${r.pass} — found [${r.passMarkers.join(',') || 'NONE'}]`);
      console.log(`  principle: [${r.principleMarkers.join(', ')}]`);
    } catch(e) {
      console.log(`FAIL: ${e.message}`);
    }
  }
  const last = results[results.length-1];
  console.log(`\n=== RESULT: ${last?.pass ? 'PASS' : 'FAIL'} ===`);
  writeFileSync('test-inference-results.json', JSON.stringify({results}, null, 2));
}

main().catch(e => { console.error(e.message); process.exit(1); });
