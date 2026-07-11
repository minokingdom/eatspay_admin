const assert = require('node:assert/strict');
const path = require('node:path');
const test = require('node:test');
const { normalizeAccountNo, extractAccountCandidates, compareAccountText, resolveProofImagePath, recognizeAccountProof } = require('../lib/account-proof-ocr');

test('normalizes separators and compares the exact account candidate', () => {
  assert.equal(normalizeAccountNo('562-169754-32139'), '56216975432139');
  assert.deepEqual(compareAccountText('입금계좌 562-169754-32139', '56216975432139'), { status: 'matched', recognizedAccountNo: '56216975432139', candidates: ['56216975432139'] });
});
test('extracts unique 8 to 20 digit candidates', () => assert.deepEqual(extractAccountCandidates('고객 12345678 / 계좌 562 169754 32139 / 12345678'), ['12345678', '56216975432139']));
test('returns the nearest candidate when no exact candidate exists', () => { const result = compareAccountText('계좌 562 169754 32138', '56216975432139'); assert.equal(result.status, 'mismatched'); assert.equal(result.recognizedAccountNo, '56216975432138'); });
test('rejects a low confidence candidate instead of showing a false mismatch', () => { const result = compareAccountText('31221814272068060', '56216975432139'); assert.equal(result.status, 'not_found'); assert.equal(result.recognizedAccountNo, ''); });
test('returns not_found when OCR text has no account candidate', () => assert.deepEqual(compareAccountText('계좌번호를 읽지 못함', '56216975432139'), { status: 'not_found', recognizedAccountNo: '', candidates: [] }));
test('resolves only image files inside uploads', () => { const uploadDir = path.resolve('uploads'); assert.equal(resolveProofImagePath('/uploads/proof.jpg', uploadDir), path.join(uploadDir, 'proof.jpg')); assert.throws(() => resolveProofImagePath('/uploads/../.env', uploadDir), /허용되지 않는/); assert.throws(() => resolveProofImagePath('/uploads/proof.pdf', uploadDir), /이미지/); });
test('runs tesseract with timeout and a numeric whitelist', async () => { const calls = []; const result = await recognizeAccountProof('/tmp/proof.jpg', '12345678', { runner: async (...args) => { calls.push(args); return '입금 계좌 1234-5678'; } }); assert.equal(result.status, 'matched'); assert.match(JSON.stringify(calls), /tessedit_char_whitelist=0123456789-/); assert.equal(calls[0][2].timeout, 20000); });
test('auto-orients and runs multiple selected-region preprocessing passes', async () => { const imageCalls = [], ocrCalls = []; await recognizeAccountProof('/tmp/proof.jpg', '12345678', { region: { x: .2, y: .3, width: .6, height: .2 }, imageRunner: async (...args) => { imageCalls.push(args); if(args[1].includes('info:'))return '1000 2000'; return ''; }, runner: async (...args) => { ocrCalls.push(args); return '12345678'; } }); assert.ok(imageCalls.some(call => call[0] === 'convert' && call[1].includes('-auto-orient') && call[1].includes('-crop') && call[1].includes('600x400+200+600'))); assert.equal(ocrCalls.length, 2); assert.ok(ocrCalls.every(call => call[1].includes('11'))); });
test('joins OCR line breaks only inside a selected region', async () => { const result = await recognizeAccountProof('/tmp/proof.jpg', '56216975432139', { region: { x: .2, y: .3, width: .6, height: .2 }, imageRunner: async (...args) => args[1].includes('info:') ? '1000 2000' : '', runner: async () => '5621\n6975432139' }); assert.equal(result.status, 'matched'); });
