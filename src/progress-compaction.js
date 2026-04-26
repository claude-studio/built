'use strict';

const TEXT_TAIL_CHARS = 200;
const RESULT_SUMMARY_CHARS = 1200;
const TOOL_RESULT_SUMMARY_CHARS = 500;
const RECENT_EVENT_LIMIT = 5;

function truncateText(value, limit) {
  const text = value == null ? '' : String(value);
  if (text.length <= limit) return {
    text,
    chars: text.length,
    truncated: false,
  };
  return {
    text: text.slice(0, limit),
    chars: text.length,
    truncated: true,
  };
}

function summarizeUnknown(value, limit) {
  if (value == null) return truncateText('', limit);
  if (typeof value === 'string') return truncateText(value, limit);
  try {
    return truncateText(JSON.stringify(value), limit);
  } catch (_) {
    return truncateText(String(value), limit);
  }
}

function extractToolResultText(event) {
  if (!event || typeof event !== 'object') return '';
  if (event.content !== undefined) return event.content;
  if (event.result !== undefined) return event.result;
  if (event.output !== undefined) return event.output;
  if (event.error !== undefined) return event.error;
  return '';
}

function createProgressCompactor() {
  const summary = {
    total_events: 0,
    by_type: {},
    tool_result_chars: 0,
    tool_result_truncated: 0,
    result_chars: 0,
    result_truncated: false,
  };
  const recent = [];

  function remember(entry) {
    recent.push(entry);
    while (recent.length > RECENT_EVENT_LIMIT) recent.shift();
  }

  function observe(event) {
    if (!event || typeof event !== 'object') return;

    const type = event.type || 'unknown';
    summary.total_events++;
    summary.by_type[type] = (summary.by_type[type] || 0) + 1;

    const entry = { type };
    if (event.subtype) entry.subtype = event.subtype;
    if (event.timestamp) entry.timestamp = event.timestamp;

    if (type === 'tool_result') {
      const compact = summarizeUnknown(extractToolResultText(event), TOOL_RESULT_SUMMARY_CHARS);
      summary.tool_result_chars += compact.chars;
      if (compact.truncated) summary.tool_result_truncated++;
      entry.summary = compact.text;
      entry.chars = compact.chars;
      entry.truncated = compact.truncated;
    } else if (type === 'result' || type === 'phase_end') {
      const compact = summarizeUnknown(event.result || '', RESULT_SUMMARY_CHARS);
      summary.result_chars = compact.chars;
      summary.result_truncated = compact.truncated;
      entry.summary = compact.text;
      entry.chars = compact.chars;
      entry.truncated = compact.truncated;
    } else if (type === 'assistant') {
      const content = (event.message && event.message.content) || [];
      const textBlock = content.find((block) => block && block.type === 'text');
      if (textBlock) entry.summary = truncateText(textBlock.text || '', TEXT_TAIL_CHARS).text;
      const toolUses = content.filter((block) => block && block.type === 'tool_use');
      if (toolUses.length > 0) entry.tool_uses = toolUses.map((block) => block.name || block.id || 'tool');
    } else if (type === 'text_delta') {
      entry.summary = truncateText(event.text || '', TEXT_TAIL_CHARS).text;
    } else if (type === 'tool_call') {
      entry.summary = event.name || event.tool || event.summary || null;
    } else if (type === 'error') {
      entry.summary = truncateText(event.message || 'unknown error', TEXT_TAIL_CHARS).text;
    }

    remember(entry);
  }

  function compactResult(value) {
    const compact = summarizeUnknown(value || '', RESULT_SUMMARY_CHARS);
    summary.result_chars = compact.chars;
    summary.result_truncated = compact.truncated;
    return {
      result: compact.text,
      result_summary: compact.text,
      result_chars: compact.chars,
      result_truncated: compact.truncated,
    };
  }

  function snapshot() {
    return {
      ...summary,
      by_type: { ...summary.by_type },
    };
  }

  function recentEvents() {
    return recent.map((entry) => ({ ...entry }));
  }

  return { observe, compactResult, snapshot, recentEvents };
}

module.exports = {
  TEXT_TAIL_CHARS,
  RESULT_SUMMARY_CHARS,
  TOOL_RESULT_SUMMARY_CHARS,
  RECENT_EVENT_LIMIT,
  truncateText,
  createProgressCompactor,
};
