#!/usr/bin/env node
/**
 * kg-signals.js
 *
 * KG review 시계열에서 방향성 신호를 계산한다.
 * 정적 스키마/참조 검사는 kg-checker.js가 담당하고,
 * 이 모듈은 최근 review 시퀀스 기반 drift streak만 계산한다.
 *
 * 연속(consecutive)의 정의:
 *   - review를 date 기준 내림차순으로 정렬한 시퀀스를 사용한다.
 *   - 가장 최근 review에 포함된 drifts_from goal만 "현재 streak" 후보가 된다.
 *   - 인접한 다음 review도 같은 goal을 drifts_from에 포함하면 streak를 이어간다.
 *   - review 작성 공백일은 끊김으로 보지 않는다. review 시퀀스가 기준이다.
 *
 * API:
 *   readRecentDriftSignals({ kgDir, days, minConsecutive, now })
 *     -> { signals, reviews }
 */

'use strict';

const fs = require('fs');
const path = require('path');

const { parse } = require('./frontmatter');

function listMd(dir) {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir).filter((f) => f.endsWith('.md')).sort();
}

function toStringArray(value) {
  if (Array.isArray(value)) return value.filter((v) => typeof v === 'string' && v.length > 0);
  if (typeof value === 'string' && value.length > 0) return [value];
  return [];
}

function parseDateOnly(raw) {
  if (typeof raw !== 'string' || raw.length === 0) return null;
  const date = /^\d{4}-\d{2}-\d{2}$/.test(raw)
    ? new Date(`${raw}T00:00:00Z`)
    : new Date(raw);
  return Number.isNaN(date.getTime()) ? null : date;
}

function formatDate(date) {
  return date.toISOString().slice(0, 10);
}

function safeReadReview(filePath) {
  try {
    const raw = fs.readFileSync(filePath, 'utf8');
    const { data } = parse(raw);
    const date = parseDateOnly(data.date);
    if (!date) return null;
    return {
      id: typeof data.id === 'string' ? data.id : null,
      date,
      dateText: formatDate(date),
      driftsFrom: toStringArray(data.drifts_from),
      path: filePath,
    };
  } catch (_) {
    return null;
  }
}

/**
 * 최근 N일 review를 읽어 내림차순으로 반환.
 *
 * @param {{ kgDir: string, days?: number, now?: Date }} opts
 * @returns {Array<{id: string|null, date: Date, dateText: string, driftsFrom: string[], path: string}>}
 */
function listRecentReviews({ kgDir, days = 7, now = new Date() }) {
  const reviewsDir = path.join(kgDir, 'reviews');
  const files = listMd(reviewsDir);

  const utcNow = new Date(Date.UTC(
    now.getUTCFullYear(),
    now.getUTCMonth(),
    now.getUTCDate(),
  ));
  const cutoff = new Date(utcNow);
  cutoff.setUTCDate(cutoff.getUTCDate() - Math.max(0, days - 1));

  return files
    .map((f) => safeReadReview(path.join(reviewsDir, f)))
    .filter(Boolean)
    .filter((r) => r.date >= cutoff && r.date <= utcNow)
    .sort((a, b) => b.date.getTime() - a.date.getTime());
}

/**
 * 최근 review 시퀀스에서 현재 drift streak 신호를 계산한다.
 *
 * @param {{ kgDir: string, days?: number, minConsecutive?: number, now?: Date }} opts
 * @returns {{ signals: Array<{type: string, goal: string, count: number, dates: string[], message: string}>, reviews: object[] }}
 */
function readRecentDriftSignals({ kgDir, days = 7, minConsecutive = 2, now = new Date() }) {
  const reviews = listRecentReviews({ kgDir, days, now });
  if (reviews.length === 0) return { signals: [], reviews };

  const latestGoals = Array.from(new Set(reviews[0].driftsFrom));
  const signals = [];

  for (const goal of latestGoals) {
    const streak = [];

    for (const review of reviews) {
      if (review.driftsFrom.includes(goal)) {
        streak.push(review);
        continue;
      }
      break;
    }

    if (streak.length < minConsecutive) continue;

    const dates = streak.map((r) => r.dateText).reverse();
    signals.push({
      type: 'drift-streak',
      goal,
      count: streak.length,
      dates,
      message: `[drift-streak] ${goal}: 최근 ${streak.length}회 review 연속 drifts_from 포함 (${dates.join(', ')})`,
    });
  }

  return { signals, reviews };
}

module.exports = {
  listRecentReviews,
  readRecentDriftSignals,
};
