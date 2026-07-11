const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');

const execFileAsync = promisify(execFile);
const IMAGE_EXTENSIONS = new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp']);

function normalizeAccountNo(value) { return String(value || '').replace(/\D/g, ''); }
function extractAccountCandidates(text) {
  const matches = String(text || '').match(/(?:\d[\s-]*){8,20}/g) || [];
  return [...new Set(matches.map(normalizeAccountNo).filter(value => value.length >= 8 && value.length <= 20))];
}
function candidateDistance(candidate, registered) {
  let difference = Math.abs(candidate.length - registered.length) * 3;
  for (let index = 0; index < Math.min(candidate.length, registered.length); index += 1) if (candidate[index] !== registered[index]) difference += 1;
  return difference;
}
function compareAccountText(text, registeredAccountNo) {
  const registered = normalizeAccountNo(registeredAccountNo);
  const candidates = extractAccountCandidates(text);
  if (!candidates.length) return { status: 'not_found', recognizedAccountNo: '', candidates: [] };
  const exact = candidates.find(candidate => candidate === registered);
  const recognized = exact || [...candidates].sort((a, b) => candidateDistance(a, registered) - candidateDistance(b, registered))[0];
  if (!exact && (recognized.length !== registered.length || candidateDistance(recognized, registered) > 2)) return { status: 'not_found', recognizedAccountNo: '', candidates: candidates.slice(0, 5) };
  return { status: exact ? 'matched' : 'mismatched', recognizedAccountNo: recognized, candidates: candidates.slice(0, 5) };
}
function parseTesseractBoxes(text, imageWidth, imageHeight) {
  const width=Number(imageWidth),height=Number(imageHeight);
  if(!Number.isFinite(width)||!Number.isFinite(height)||width<=0||height<=0)return [];
  return String(text||'').split(/\r?\n/).map(line=>line.trim().split(/\s+/)).filter(parts=>/^\d$/.test(parts[0]||'')&&parts.length>=6).map(parts=>{
    const left=Number(parts[1]),bottom=Number(parts[2]),right=Number(parts[3]),top=Number(parts[4]);
    if(![left,bottom,right,top].every(Number.isFinite)||right<=left||top<=bottom)return null;
    return {digit:parts[0],x:left/width,y:(height-top)/height,width:(right-left)/width,height:(top-bottom)/height};
  }).filter(Boolean);
}
function mapCharacterBoxesToSelection(boxes, selectedRegion, paddedRegion) {
  const selected=normalizeOcrRegion(selectedRegion),padded=paddedRegion;
  return (Array.isArray(boxes)?boxes:[]).map(box=>{
    const fullX=padded.x+box.x*padded.width,fullY=padded.y+box.y*padded.height;
    return {digit:box.digit,x:(fullX-selected.x)/selected.width,y:(fullY-selected.y)/selected.height,width:box.width*padded.width/selected.width,height:box.height*padded.height/selected.height};
  }).filter(box=>[box.x,box.y,box.width,box.height].every(Number.isFinite)&&box.x>=0&&box.y>=0&&box.x+box.width<=1&&box.y+box.height<=1);
}
function normalizeOcrRegion(value) {
  const source = value && typeof value === 'object' ? value : {};
  const region = { x: Number(source.x), y: Number(source.y), width: Number(source.width), height: Number(source.height) };
  if (!Object.values(region).every(Number.isFinite) || region.x < 0 || region.y < 0 || region.width < .01 || region.height < .003 || region.x + region.width > 1 || region.y + region.height > 1) throw new Error('계좌 영역을 다시 선택해주세요.');
  return region;
}
function resolveProofImagePath(documentUrl, uploadDir) {
  const raw = String(documentUrl || '').trim();
  if (!raw.startsWith('/uploads/')) throw new Error('허용되지 않는 증빙 경로입니다.');
  let fileKey;
  try { fileKey = decodeURIComponent(raw.slice('/uploads/'.length)); } catch { throw new Error('허용되지 않는 증빙 경로입니다.'); }
  if (!fileKey || fileKey.includes('/') || fileKey.includes('\\') || fileKey === '.' || fileKey === '..') throw new Error('허용되지 않는 증빙 경로입니다.');
  if (!IMAGE_EXTENSIONS.has(path.extname(fileKey).toLowerCase())) throw new Error('OCR은 이미지 증빙만 지원합니다.');
  const root = path.resolve(uploadDir);
  const target = path.resolve(root, fileKey);
  const relative = path.relative(root, target);
  if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) throw new Error('허용되지 않는 증빙 경로입니다.');
  return target;
}
async function defaultRunner(command, args, options) { const result = await execFileAsync(command, args, options); return result.stdout; }
async function prepareSelectedRegion(imagePath, region, imageRunner = defaultRunner) {
  const selected = normalizeOcrRegion(region);
  const normalized = {
    x: Math.max(0, selected.x - .01),
    y: Math.max(0, selected.y - .01),
    width: Math.min(1 - Math.max(0, selected.x - .01), selected.width + .02),
    height: Math.min(1 - Math.max(0, selected.y - .01), selected.height + .02)
  };
  const dimensionsResult = await imageRunner('convert', [imagePath, '-auto-orient', '-format', '%w %h', 'info:'], { timeout: 10000, maxBuffer: 1024 });
  const [imageWidth, imageHeight] = String(dimensionsResult?.stdout || dimensionsResult || '').trim().split(/\s+/).map(Number);
  if (!Number.isFinite(imageWidth) || !Number.isFinite(imageHeight)) throw new Error('증빙 이미지 크기를 확인하지 못했습니다.');
  const cropWidth=Math.max(1,Math.round(imageWidth*normalized.width)),cropHeight=Math.max(1,Math.round(imageHeight*normalized.height));
  const geometry = `${cropWidth}x${cropHeight}+${Math.max(0, Math.round(imageWidth * normalized.x))}+${Math.max(0, Math.round(imageHeight * normalized.y))}`;
  const prefix = path.join(os.tmpdir(), `eatspay-ocr-${crypto.randomUUID()}`);
  const contrastPath = `${prefix}-contrast.png`, thresholdPath = `${prefix}-threshold.png`;
  const common = [imagePath, '-auto-orient', '-crop', geometry, '+repage', '-resize', '300%', '-colorspace', 'Gray'];
  await imageRunner('convert', [...common, '-contrast-stretch', '1%x1%', contrastPath], { timeout: 20000, maxBuffer: 1024 * 1024 });
  await imageRunner('convert', [...common, '-threshold', '65%', thresholdPath], { timeout: 20000, maxBuffer: 1024 * 1024 });
  const paths=[contrastPath,thresholdPath];paths.meta={selected,normalized,processedWidth:cropWidth*3,processedHeight:cropHeight*3};return paths;
}
async function recognizeAccountProof(imagePath, registeredAccountNo, options = {}) {
  const runner = options.runner || defaultRunner;
  let temporaryImagePaths = [];
  try {
    if (options.region) temporaryImagePaths = await prepareSelectedRegion(imagePath, options.region, options.imageRunner || defaultRunner);
    const inputs = temporaryImagePaths.length ? temporaryImagePaths : [imagePath];
    const outputs = [];
    for (const input of inputs) {
      const output = await runner('tesseract', [input, 'stdout', '--psm', options.region ? '11' : '6', '-l', 'eng', '-c', 'tessedit_char_whitelist=0123456789- '], { timeout: 20000, maxBuffer: 1024 * 1024, windowsHide: true });
      outputs.push(typeof output === 'string' ? output : String(output?.stdout || ''));
    }
    const combined = outputs.join('\n');
    const registered = normalizeAccountNo(registeredAccountNo);
    let result=options.region&&registered&&normalizeAccountNo(combined).includes(registered)?{status:'matched',recognizedAccountNo:registered,candidates:[registered]}:compareAccountText(combined,registeredAccountNo);
    result.characterBoxes=[];
    if(options.region&&options.includeCharacterBoxes&&result.recognizedAccountNo&&temporaryImagePaths.meta){
      const passIndex=outputs.findIndex(output=>normalizeAccountNo(output).includes(result.recognizedAccountNo));
      if(passIndex>=0){
        const boxOutput=await runner('tesseract',[inputs[passIndex],'stdout','--psm','11','-l','eng','-c','tessedit_char_whitelist=0123456789- ','makebox'],{timeout:20000,maxBuffer:1024*1024,windowsHide:true});
        const parsed=parseTesseractBoxes(typeof boxOutput==='string'?boxOutput:String(boxOutput?.stdout||''),temporaryImagePaths.meta.processedWidth,temporaryImagePaths.meta.processedHeight);
        const joined=parsed.map(box=>box.digit).join(''),start=joined.indexOf(result.recognizedAccountNo);
        if(start>=0){const selectedBoxes=parsed.slice(start,start+result.recognizedAccountNo.length);if(selectedBoxes.length===result.recognizedAccountNo.length)result.characterBoxes=mapCharacterBoxesToSelection(selectedBoxes,temporaryImagePaths.meta.selected,temporaryImagePaths.meta.normalized);}
      }
    }
    return result;
  } catch (error) {
    if (error?.code === 'ENOENT') throw new Error('OCR 엔진이 설치되어 있지 않습니다.');
    if (error?.killed || error?.code === 'ETIMEDOUT') throw new Error('OCR 처리 시간이 초과되었습니다.');
    if (/계좌 영역|이미지 크기/.test(String(error?.message || ''))) throw error;
    throw new Error('증빙 이미지를 인식하지 못했습니다.');
  } finally { await Promise.all(temporaryImagePaths.map(file => fs.promises.unlink(file).catch(() => {}))); }
}
function assertProofImageExists(imagePath) { const stat = fs.statSync(imagePath); if (!stat.isFile()) throw new Error('증빙 이미지 파일을 찾을 수 없습니다.'); return imagePath; }

module.exports = { normalizeAccountNo, extractAccountCandidates, compareAccountText, normalizeOcrRegion, resolveProofImagePath, recognizeAccountProof, assertProofImageExists, parseTesseractBoxes, mapCharacterBoxesToSelection };
