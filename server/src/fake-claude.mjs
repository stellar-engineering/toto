#!/usr/bin/env node
// Test stand-in for the claude CLI: each prompt asks permission for two tool calls,
// then reports the decision it was given for each.
import { createInterface } from 'node:readline';

const out = (o) => console.log(JSON.stringify(o));
const answers = [];
createInterface({ input: process.stdin }).on('line', (line) => {
  const msg = JSON.parse(line);
  if (msg.type === 'user') {
    for (const n of [1, 2]) {
      out({ type: 'assistant', message: { content: [{ type: 'tool_use', id: `t${n}`, name: 'Bash', input: { n } }] } });
      out({ type: 'control_request', request_id: `r${n}`, request: { subtype: 'can_use_tool', tool_name: 'Bash', input: { n }, tool_use_id: `t${n}` } });
    }
  }
  if (msg.type === 'control_response') {
    const { behavior, updatedInput } = msg.response.response;
    answers.push(`${msg.response.request_id}:${behavior}${updatedInput?.answers ? '=' + JSON.stringify(updatedInput.answers) : ''}`);
    if (answers.length === 2) {
      out({ type: 'assistant', message: { content: [{ type: 'text', text: answers.sort().join(' ') }] } });
      out({ type: 'result', is_error: false });
    }
  }
});
