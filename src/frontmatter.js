#!/usr/bin/env node
/**
 * frontmatter.js
 *
 * YAML frontmatter 최소 파서. 외부 패키지 없이 Node.js 표준 라이브러리만 사용.
 *
 * 지원 타입:
 *   - 문자열, 숫자, boolean, null
 *   - inline 배열: [a, b, c]
 *   - block 배열:  - item
 *   - 최대 2단계 객체 (key: / subkey: value)
 *
 * API:
 *   parse(text)              -> { data, content }
 *   stringify(data, content) -> string
 */

'use strict';

// ---------------------------------------------------------------------------
// 값 파싱 (스칼라 + inline 배열)
// ---------------------------------------------------------------------------

/**
 * 원시 YAML 값 문자열을 JS 값으로 변환.
 * inline 배열 [a, b, c] 도 처리.
 */
function parseValue(raw) {
  const s = (raw == null ? '' : String(raw)).trim();

  if (s === 'null' || s === '~' || s === '') return null;
  if (s === 'true') return true;
  if (s === 'false') return false;

  // inline 배열
  if (s.startsWith('[') && s.endsWith(']')) {
    const inner = s.slice(1, -1).trim();
    if (inner === '') return [];
    return splitInlineArray(inner).map(parseValue);
  }

  // 숫자 (isNaN 체크, 단 빈 문자열 제외)
  if (s !== '' && !isNaN(s)) return Number(s);

  // 따옴표 문자열
  if (s.startsWith('"') && s.endsWith('"')) {
    return s.slice(1, -1).replace(/\\"/g, '"');
  }
  if (s.startsWith("'") && s.endsWith("'")) {
    return s.slice(1, -1).replace(/\\'/g, "'");
  }

  return s;
}

/**
 * inline 배열 내부 문자열을 `,` 로 분리.
 * 따옴표 내부 쉼표 보호.
 */
function splitInlineArray(inner) {
  const items = [];
  let buf = '';
  let inQuote = false;
  let quoteChar = '';

  for (let i = 0; i < inner.length; i++) {
    const ch = inner[i];
    if (inQuote) {
      buf += ch;
      if (ch === quoteChar) inQuote = false;
    } else if (ch === '"' || ch === "'") {
      inQuote = true;
      quoteChar = ch;
      buf += ch;
    } else if (ch === ',') {
      items.push(buf.trim());
      buf = '';
    } else {
      buf += ch;
    }
  }
  if (buf.trim() !== '') items.push(buf.trim());
  return items;
}

// ---------------------------------------------------------------------------
// YAML 블록 파싱 (frontmatter 본문)
// ---------------------------------------------------------------------------

function getIndent(line) {
  const m = line.match(/^(\s*)/);
  return m ? m[1].length : 0;
}

/**
 * frontmatter 본문 라인 배열을 JS 객체로 변환.
 * 최대 2단계 객체, block 배열 지원.
 */
function parseYamlLines(lines) {
  const data = {};
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];

    if (line.trim() === '' || line.trim().startsWith('#')) {
      i++;
      continue;
    }

    const indent = getIndent(line);
    if (indent !== 0) {
      i++;
      continue;
    }

    const colonIdx = line.indexOf(':');
    if (colonIdx === -1) {
      i++;
      continue;
    }

    const key = line.slice(0, colonIdx).trim();
    const restTrimmed = line.slice(colonIdx + 1).trim();

    if (restTrimmed !== '') {
      data[key] = parseValue(restTrimmed);
      i++;
    } else {
      // 다음 들여쓰기 블록 수집
      const blockLines = [];
      let j = i + 1;
      while (j < lines.length) {
        const nl = lines[j];
        if (nl.trim() === '') { j++; continue; }
        if (getIndent(nl) === 0) break;
        blockLines.push(nl);
        j++;
      }

      if (blockLines.length === 0) {
        data[key] = null;
      } else if (blockLines[0].trim().startsWith('- ')) {
        // block 배열
        data[key] = blockLines
          .filter(l => l.trim().startsWith('- '))
          .map(l => parseValue(l.trim().slice(2)));
      } else {
        // 중첩 객체 (2단계)
        const obj = {};
        for (const nl of blockLines) {
          const ci = nl.indexOf(':');
          if (ci === -1) continue;
          const sk = nl.slice(0, ci).trim();
          const sv = nl.slice(ci + 1).trim();
          obj[sk] = parseValue(sv);
        }
        data[key] = obj;
      }

      i = j;
    }
  }

  return data;
}

// ---------------------------------------------------------------------------
// parse
// ---------------------------------------------------------------------------

/**
 * Markdown 문자열에서 YAML frontmatter를 파싱.
 *
 * @param {string} text  전체 파일 내용
 * @returns {{ data: object, content: string }}
 */
function parse(text) {
  if (typeof text !== 'string') throw new TypeError('parse: text must be a string');

  const lines = text.split('\n');

  if (lines[0].trim() !== '---') {
    return { data: {}, content: text };
  }

  let closeIdx = -1;
  for (let i = 1; i < lines.length; i++) {
    if (lines[i].trim() === '---') {
      closeIdx = i;
      break;
    }
  }

  if (closeIdx === -1) {
    return { data: {}, content: text };
  }

  const fmLines = lines.slice(1, closeIdx);
  const data = parseYamlLines(fmLines);

  const afterLines = lines.slice(closeIdx + 1);
  // 관례: 닫는 --- 바로 다음 빈 줄 하나 제거
  const content = afterLines.length > 0 && afterLines[0] === ''
    ? afterLines.slice(1).join('\n')
    : afterLines.join('\n');

  return { data, content };
}

// ---------------------------------------------------------------------------
// stringify
// ---------------------------------------------------------------------------

/** 문자열을 따옴표 처리해야 하면 true */
function needsQuote(s) {
  if (s === '') return true;
  if (['true', 'false', 'null', '~'].includes(s)) return true;
  if (!isNaN(s)) return true;
  if (/[:#\[\]{},&*?|<>=!%@`'"\\]/.test(s)) return true;
  if (s !== s.trim()) return true;
  return false;
}

function stringifyScalar(val) {
  if (val === null || val === undefined) return 'null';
  if (typeof val === 'boolean') return String(val);
  if (typeof val === 'number') return String(val);
  if (typeof val === 'string') {
    if (needsQuote(val)) {
      return `"${val.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
    }
    return val;
  }
  return String(val);
}

function stringifyInlineArray(arr) {
  return `[${arr.map(stringifyScalar).join(', ')}]`;
}

/**
 * data 객체와 본문 content를 YAML frontmatter 문자열로 직렬화.
 *
 * @param {object} data     frontmatter 데이터 객체
 * @param {string} content  본문 (기본값 '')
 * @returns {string}
 */
function stringify(data, content = '') {
  if (typeof data !== 'object' || data === null) {
    throw new TypeError('stringify: data must be a non-null object');
  }

  const lines = ['---'];

  for (const [key, val] of Object.entries(data)) {
    if (Array.isArray(val)) {
      lines.push(`${key}: ${stringifyInlineArray(val)}`);
    } else if (val !== null && typeof val === 'object') {
      lines.push(`${key}:`);
      for (const [subKey, subVal] of Object.entries(val)) {
        lines.push(`  ${subKey}: ${stringifyScalar(subVal)}`);
      }
    } else {
      lines.push(`${key}: ${stringifyScalar(val)}`);
    }
  }

  lines.push('---');

  const fm = lines.join('\n');
  if (!content) return `${fm}\n`;
  return `${fm}\n${content}`;
}

// ---------------------------------------------------------------------------
// exports
// ---------------------------------------------------------------------------

module.exports = { parse, stringify };
