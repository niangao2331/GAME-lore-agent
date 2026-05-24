// Quick integration test script for Node.js
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const apiContent = readFileSync(join(__dirname, '..', 'API.txt'), 'utf-8');
const lines = apiContent.split('\n').filter(Boolean);
const model = lines[0].trim();
const apiKey = lines[1].trim();
const baseUrl = lines[2].trim();

console.log('Using API:', baseUrl, 'Model:', model, 'Key:', apiKey.slice(0, 10) + '...');

// Test 1: Single-user simple question
async function testSingleUser() {
  console.log('\n=== Test 1: Single User Chat ===');
  const res = await fetch('http://localhost:3000/api/chat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      message: 'Hello! Just say "Hi there, I am working!" and nothing else.',
      config: { apiKey, baseUrl, model, protocol: 'openai' }
    })
  });

  const sessionId = res.headers.get('x-session-id');
  console.log('Session ID:', sessionId);

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let fullText = '';

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
        if (event.type === 'delta') {
          fullText += event.text;
          process.stdout.write(event.text);
        } else if (event.type === 'done') {
          console.log('\n[Stream complete]');
        } else if (event.type === 'error') {
          console.log('\n[ERROR]', event.message);
        }
      } catch {}
    }
  }

  console.log('\nFull response:', fullText);
  return { success: fullText.length > 0, sessionId };
}

// Test 2: Multi-turn conversation
async function testMultiTurn(sessionId) {
  console.log('\n=== Test 2: Multi-Turn Conversation ===');
  const res = await fetch('http://localhost:3000/api/chat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      sessionId,
      message: 'What is 2+2? Answer with just the number.',
      config: { apiKey, baseUrl, model, protocol: 'openai' }
    })
  });

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let fullText = '';

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
        if (event.type === 'delta') {
          fullText += event.text;
          process.stdout.write(event.text);
        }
      } catch {}
    }
  }

  console.log('\nResponse:', fullText);
  return fullText.includes('4');
}

// Test 3: Tool calling
async function testToolCalling() {
  console.log('\n=== Test 3: Tool Calling ===');
  const res = await fetch('http://localhost:3000/api/chat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      message: 'Use the calculator tool to compute 15 * 37',
      config: { apiKey, baseUrl, model, protocol: 'openai' }
    })
  });

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let sawToolStart = false;
  let sawToolEnd = false;
  let fullText = '';

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
        if (event.type === 'tool_start') {
          console.log('[Tool start]', event.name);
          sawToolStart = true;
        } else if (event.type === 'tool_end') {
          console.log('[Tool end]', event.name, '→', event.result?.slice(0, 100));
          sawToolEnd = true;
        } else if (event.type === 'delta') {
          fullText += event.text;
          process.stdout.write(event.text);
        } else if (event.type === 'error') {
          console.log('[ERROR]', event.message);
        }
      } catch {}
    }
  }

  console.log('\nFull:', fullText);
  return { sawToolStart, sawToolEnd };
}

// Test 4: Multiple users simultaneously
async function testMultiUser() {
  console.log('\n=== Test 4: Multi-User Simultaneous ===');

  const messages = [
    'Say exactly "User 1 here" and nothing else.',
    'Say exactly "User 2 here" and nothing else.',
    'Say exactly "User 3 here" and nothing else.'
  ];

  const results = await Promise.all(messages.map(async (msg, i) => {
    const res = await fetch('http://localhost:3000/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        message: msg,
        config: { apiKey, baseUrl, model, protocol: 'openai' }
      })
    });

    const sessionId = res.headers.get('x-session-id');
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let fullText = '';

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
          if (event.type === 'delta') fullText += event.text;
        } catch {}
      }
    }

    console.log(`User ${i + 1} session ${sessionId}: ${fullText}`);
    return { sessionId, response: fullText };
  }));

  const uniqueSessions = new Set(results.map(r => r.sessionId));
  console.log(`Unique sessions: ${uniqueSessions.size} (expected 3)`);
  return uniqueSessions.size === 3;
}

// Test 5: Skill switching
async function testSkills() {
  console.log('\n=== Test 5: Skill Selection ===');
  const res = await fetch('http://localhost:3000/api/chat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      message: 'Say "I am the coder skill" if you are a coding assistant.',
      config: { apiKey, baseUrl, model, protocol: 'openai' },
      skill: 'coder'
    })
  });

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let fullText = '';

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
        if (event.type === 'delta') {
          fullText += event.text;
          process.stdout.write(event.text);
        }
      } catch {}
    }
  }

  console.log('\nCoder skill response:', fullText);
  return fullText.length > 0;
}

// Run all tests
const result1 = await testSingleUser();
const result2 = await testMultiTurn(result1.sessionId);
const result3 = await testToolCalling();
const result4 = await testMultiUser();
const result5 = await testSkills();

console.log('\n========================================');
console.log('TEST RESULTS SUMMARY');
console.log('========================================');
console.log('Test 1 - Single User:', result1.success ? 'PASS' : 'FAIL');
console.log('Test 2 - Multi-Turn:', result2 ? 'PASS' : 'FAIL');
console.log('Test 3 - Tool Calling:', result3.sawToolStart && result3.sawToolEnd ? 'PASS' : 'FAIL');
console.log('Test 4 - Multi-User (3 concurrent):', result4 ? 'PASS' : 'FAIL');
console.log('Test 5 - Skill Selection:', result5 ? 'PASS' : 'FAIL');
