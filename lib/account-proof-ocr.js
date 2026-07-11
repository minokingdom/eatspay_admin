const fs = require('node:fs');
const path = require('node:path');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');

const execFileAsync = promisify(execFile);
const IMAGE_EXTENSIONS = new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp']);

function normalizeAccountNo(value) {
  return String(value || '').replace(/\D/g, '');
}

function extractAccountCandidates(text) {
  const matches = String(text || '').match(/(?:\d[\s-]*){8,20}/g) || [];
  const unique = [];
  for (const match of matches) {
    const candidate = normalizeAccountNo(match);
    if (candidate.length >= 8 && candidate.length <= 20 && !unique.includes(candidate)) unique.push(candidate);
  }
  return unique;
}

function candidateDistance(candidate, registered) {
  let difference = Math.abs(candidate.length - registered.length) * 3;
  const length = Math.min(candidate.length, registered.length);
  for (let index = 0; index < length; index += 1) {
    if (candidate[index] !== registered[index]) difference += 1;
  }
  return difference;
}

function compareAccountText(text, registeredAccountNo) {
  const registered = normalizeAccountNo(registeredAccountNo);
  const candidates = extractAccountCandidates(text);
  if (!candidates.length) return { status: 'not_found', recognizedAccountNo: '', candidates: [] };
  const exact = candidates.find(candidate => candidate === registered);
  const recognized = exact || [...candidates].sort((a, b) => candidateDistance(a, registered) - candidateDistance(b, registered))[0];
  return { status: exact ? 'matched' : 'mismatched', recognizedAccountNo: recognized, candidates: candidates.slice(0, 5) };
}

function resolveProofImagePath(documentUrl, uploadDir) {
  const raw = String(documentUrl || '').trim();
  if (!raw.startsWith('/uploads/')) throw new Error('허용되지 않는 증빙 경로입니다.');
  let fileKey;
  try { fileKey = decodeURIComponent(raw.slice('/uploads/'.length)); } catch { throw new Error('허용되지 않는 증빙 경로입니다.'); }
  if (!fileKey || fileKey.includes('/') || fileKey.includes('\\') || fileKey === '.' || fileKey === '..') {
    throw new Error('허용되지 않는 증빙 경로입니다.');
  }
  const extension = path.extname(fileKey).toLowerCase();
  if (!IMAGE_EXTENSIONS.has(extension)) throw new Error('OCR은 이미지 증빙만 지원합니다.');
  const root = path.resolve(uploadDir);
  const target = path.resolve(root, fileKey);
  const relative = path.relative(root, target);
  if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) throw new Error('허용되지 않는 증빙 경로입니다.');
  return target;
}

async function defaultRunner(command, args, options) {
  const result = await execFileAsync(command, args, options);
  return result.stdout;
}

async function recognizeAccountProof(imagePath, registeredAccountNo, options = {}) {
  const runner = options.runner || defaultRunner;
  let output;
  try {
    output = await runner('tesseract', [
      imagePath,
      'stdout',
      '--psm', '6',
      '-l', 'eng',
      '-c', 'tessedit_char_whitelist=0123456789- '
    ], { timeout: 20000, maxBuffer: 1024 * 1024, windowsHide: true });
  } catch (error) {
    if (error?.code === 'ENOENT') throw new Error('OCR 엔진이 설치되어 있지 않습니다.');
    if (error?.killed || error?.code === 'ETIMEDOUT') throw new Error('OCR 처리 시간이 초과되었습니다.');
    throw new Error('증빙 이미지를 인식하지 못했습니다.');
  }
  const text = typeof output === 'string' ? output : String(output?.stdout || '');
  return compareAccountText(text, registeredAccountNo);
}

function assertProofImageExists(imagePath) {
  const stat = fs.statSync(imagePath);
  if (!stat.isFile()) throw new Error('증빙 이미지 파일을 찾을 수 없습니다.');
  return imagePath;
}

module.exports = {
  normalizeAccountNo,
  extractAccountCandidates,
  compareAccountText,
  resolveProofImagePath,
  recognizeAccountProof,
  assertProofImageExists
};
