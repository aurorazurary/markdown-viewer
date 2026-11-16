// A local stand-in for the Anthropic and OpenAI-compatible APIs, used by the AI tests.
// Records every request and streams answers back as server-sent events.
import http from 'node:http';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** `answer`: optional canned answer text (default: the test answer). */
export async function startMockAi({ answer } = {}) {
  const requests = [];
  const server = http.createServer(async (req, res) => {
    let raw = '';
    for await (const c of req) raw += c;
    let body = {};
    try { body = JSON.parse(raw); } catch {}
    requests.push({ path: req.url, headers: req.headers, body });

    if (body.model === 'bad-model') {
      res.writeHead(404, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ type: 'error', error: { type: 'not_found_error', message: 'model: bad-model not found' } }));
      return;
    }
    res.writeHead(200, { 'content-type': 'text/event-stream' });
    const isAnthropic = req.url === '/v1/messages';
    const delta = (text) => isAnthropic
      ? `event: content_block_delta\ndata: ${JSON.stringify({ type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text } })}\n\n`
      : `data: ${JSON.stringify({ choices: [{ index: 0, delta: { content: text }, finish_reason: null }] })}\n\n`;

    if (body.model === 'slow') {
      for (let i = 0; i < 50 && !res.destroyed; i++) { res.write(delta(`chunk ${i} `)); await sleep(150); }
      res.end();
      return;
    }
    if (isAnthropic) {
      res.write(`event: message_start\ndata: ${JSON.stringify({ type: 'message_start', message: { id: 'msg_test', model: body.model } })}\n\n`);
      res.write(`event: content_block_start\ndata: ${JSON.stringify({ type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } })}\n\n`);
    }
    if (answer) {
      for (const word of answer.match(/\S+\s*/g)) { res.write(delta(word)); await sleep(5); }
    } else {
      const parts = ['- **Gist:** a test document about 日本語', ' notes.\n- Costs are in [Budget](#budget).\n'];
      // Split the first event in the middle of a multi-byte character to test decoding across chunks.
      const first = Buffer.from(delta(parts[0]));
      const cut = first.indexOf(Buffer.from('日')) + 1;
      res.write(first.subarray(0, cut));
      await sleep(30);
      res.write(first.subarray(cut));
      res.write(delta(parts[1]));
    }
    if (isAnthropic) {
      res.write(`event: message_delta\ndata: ${JSON.stringify({ type: 'message_delta', delta: { stop_reason: 'end_turn' }, usage: { output_tokens: 20 } })}\n\n`);
      res.write(`event: message_stop\ndata: {"type":"message_stop"}\n\n`);
    } else {
      res.write(`data: ${JSON.stringify({ choices: [{ index: 0, delta: {}, finish_reason: 'stop' }] })}\n\ndata: [DONE]\n\n`);
    }
    res.end();
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  return { url: `http://127.0.0.1:${server.address().port}`, requests, close: () => server.close() };
}
